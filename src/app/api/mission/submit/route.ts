import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Driver = "memory" | "kv";

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}
function parseMission(missionIdRaw: string) {
  const m = (missionIdRaw || "").trim();
  const idx = m.indexOf(":");
  if (idx > 0) {
    const p = m.slice(0, idx).toLowerCase();
    if (p === "daily" || p === "weekly" || p === "once") {
      return { period: p as "daily" | "weekly" | "once", id: m };
    }
  }
  return { period: "once" as const, id: m || "once:default" };
}
function periodKeyFor(period: "once" | "daily" | "weekly") {
  if (period === "daily") return todayKey();
  if (period === "weekly") return isoWeekKey();
  return "once";
}

type MemDB = { kv: Map<string, any> };
function getMemDB(): MemDB {
  const g = globalThis as unknown as { __ONE_MISSION_MEMDB__?: MemDB };
  if (!g.__ONE_MISSION_MEMDB__) g.__ONE_MISSION_MEMDB__ = { kv: new Map() };
  return g.__ONE_MISSION_MEMDB__;
}
async function memGet(key: string) {
  return getMemDB().kv.get(key);
}
async function memSet(key: string, val: any) {
  getMemDB().kv.set(key, val);
}
async function memLPush(key: string, val: any, maxLen = 500) {
  const cur = (await memGet(key)) ?? [];
  const arr = Array.isArray(cur) ? cur : [];
  arr.unshift(val);
  await memSet(key, arr.slice(0, maxLen));
}

async function kvClient() {
  return getRedis();
}

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function s(v: any, max = 2000) {
  return String(v ?? "").slice(0, max);
}
function asInt(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

type ProofFile = { name: string; type: string; size: number; dataUrl: string };

type Body = {
  wallet?: string;
  walletAddress?: string;
  address?: string;

  missionId?: string;
  id?: string;

  proof?: { kind?: string; text?: string; url?: string; tx?: string };

  proofUrl?: string;
  note?: string;
  files?: ProofFile[];

  periodKey?: string;
  points?: number;
};

function makeSubmissionId(now: number, wallet: string) {
  const nonce = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${now}-${wallet.slice(0, 6)}-${nonce}`;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Body;

    const wallet = s(body.wallet || body.walletAddress || body.address || "", 128).trim();
    const missionIdRaw = s(body.missionId || body.id || "", 128).trim();
    if (!wallet) return noStoreJson({ ok: false, error: "missing wallet" }, 400);
    if (!missionIdRaw) return noStoreJson({ ok: false, error: "missing missionId" }, 400);

    const m = parseMission(missionIdRaw);
    const pKey = s(body.periodKey || "", 64).trim() || periodKeyFor(m.period);

    const now = Date.now();
    const driver = pickDriver();

    const proofUrl = s(body.proofUrl || body.proof?.url || "", 2000).trim();
    const note = s(body.note || body.proof?.text || "", 2000).trim();
    const tx = s(body.proof?.tx || "", 2000).trim();

    const rawFiles = Array.isArray(body.files) ? body.files : [];
    const MAX_FILES = 3;
    const MAX_SIZE = 2 * 1024 * 1024;
    const ALLOW = new Set(["image/png", "image/jpeg", "image/webp"]);

    const files = rawFiles
      .slice(0, MAX_FILES)
      .map((f) => ({
        name: s(f?.name, 120),
        type: s(f?.type, 40),
        size: asInt(f?.size, 0),
        dataUrl: s(f?.dataUrl, 2_500_000),
      }))
      .filter((f) => f.name && f.dataUrl && ALLOW.has(f.type) && f.size > 0 && f.size <= MAX_SIZE)
      .map((f) => ({ ...f, dataUrl: f.dataUrl.slice(0, 1_500_000) }));

    const points = asInt(body.points, 0);

    const kPending = `submissions:pending`;
    const dedupKey = `submit:${wallet}:${m.id}:${pKey}`;

    const submissionId = makeSubmissionId(now, wallet);

    const item = {
      submissionId,
      ts: now,
      wallet,
      missionId: m.id,
      period: m.period,
      periodKey: pKey,
      points,
      proof: { kind: "mixed", url: proofUrl, text: note, tx, files },
      status: "pending",
    };

    if (driver === "kv") {
      const redis = await kvClient();
      const existed = await (redis as any).get(dedupKey);
      if (existed) {
        return noStoreJson({ ok: true, pending: true, duplicated: true, wallet, missionId: m.id, period: m.period, periodKey: pKey });
      }

      await (redis as any).set(dedupKey, "1");
      if (m.period === "daily") await (redis as any).expire(dedupKey, 86400 * 8);
      else if (m.period === "weekly") await (redis as any).expire(dedupKey, 86400 * 60);
      else await (redis as any).expire(dedupKey, 86400 * 365);

      if (typeof (redis as any).lPush === "function") {
        await (redis as any).lPush(kPending, JSON.stringify(item));
        if (typeof (redis as any).lTrim === "function") await (redis as any).lTrim(kPending, 0, 999);
      } else {
        const raw = await (redis as any).get(kPending);
        let arr: any[] = [];
        try { arr = raw ? JSON.parse(raw) : []; } catch {}
        arr.unshift(item);
        arr = arr.slice(0, 1000);
        await (redis as any).set(kPending, JSON.stringify(arr));
      }

      return noStoreJson({ ok: true, pending: true, submissionId, wallet, missionId: m.id, period: m.period, periodKey: pKey });
    }

    const existed = await memGet(dedupKey);
    if (existed) {
      return noStoreJson({ ok: true, pending: true, duplicated: true, wallet, missionId: m.id, period: m.period, periodKey: pKey });
    }
    await memSet(dedupKey, true);
    await memLPush(kPending, item, 1000);

    return noStoreJson({ ok: true, pending: true, submissionId, wallet, missionId: m.id, period: m.period, periodKey: pKey });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? "submit_error" }, 500);
  }
}
