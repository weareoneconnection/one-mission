import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";
import { requireAdmin } from "@/lib/server/requireAdmin"; // ✅ session first + signature fallback

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Driver = "memory" | "kv";
type Body = {
  submissionId?: string;
  reason?: string;
  note?: string;
};

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeParse(s: any) {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return { raw: s };
  }
}

async function kvClient() {
  return getRedis();
}

// ---- memory store ----
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
async function memLPush(key: string, val: any, maxLen = 1000) {
  const cur = (await memGet(key)) ?? [];
  const arr = Array.isArray(cur) ? cur : [];
  arr.unshift(val);
  await memSet(key, arr.slice(0, maxLen));
}

export async function POST(req: Request) {
  // ✅ 改这里：requireAdmin（session 优先，不用一直切管理员钱包；签名仍可作为兜底）
  const auth = await requireAdmin(req);
  if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, 401);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const sid = String(body.submissionId || "").trim();
    if (!sid) return noStoreJson({ ok: false, error: "missing submissionId" }, 400);

    const driver = pickDriver();
    const kPending = "submissions:pending";
    const kRejected = "submissions:rejected";

    const reason = String(body.reason || "").trim();
    const note = String(body.note || "").trim();
    const reviewedAt = Date.now();

    if (driver === "kv") {
      const redis: any = await kvClient();

      const raw: string[] =
        typeof redis.lRange === "function" ? await redis.lRange(kPending, 0, 999) : [];
      const arr = Array.isArray(raw) ? raw : [];

      let foundRaw: string | null = null;
      let foundObj: any = null;

      for (const s of arr) {
        const obj = safeParse(s);
        if (String(obj?.submissionId || "") === sid) {
          foundRaw = s;
          foundObj = obj;
          break;
        }
      }
      if (!foundObj) return noStoreJson({ ok: false, error: "submission_not_found_in_pending" }, 404);

      if (typeof redis.lRem === "function") {
        await redis.lRem(kPending, 1, foundRaw);
      } else {
        const keep = arr.filter((x) => x !== foundRaw);
        await redis.set(kPending, JSON.stringify(keep.map(safeParse)));
      }

      const rejectedEntry = {
        ...foundObj,
        reviewedAt,
        status: "rejected",
        rejectReason: reason || "rejected",
        rejectNote: note || "",
        admin: auth.wallet,
      };

      if (typeof redis.lPush === "function") {
        await redis.lPush(kRejected, JSON.stringify(rejectedEntry));
        if (typeof redis.lTrim === "function") await redis.lTrim(kRejected, 0, 999);
      } else {
        const blob = await redis.get(kRejected);
        let list: any[] = [];
        try {
          list = blob ? JSON.parse(blob) : [];
        } catch {}
        list.unshift(rejectedEntry);
        list = list.slice(0, 1000);
        await redis.set(kRejected, JSON.stringify(list));
      }

      return noStoreJson({ ok: true, rejected: true, submissionId: sid, driver });
    }

    // memory
    const list = ((await memGet(kPending)) ?? []) as any[];
    const pending = Array.isArray(list) ? list : [];
    const idx = pending.findIndex((x) => String(x?.submissionId || "") === sid);
    if (idx < 0) return noStoreJson({ ok: false, error: "submission_not_found_in_pending" }, 404);

    const found = pending[idx];
    const next = [...pending.slice(0, idx), ...pending.slice(idx + 1)];
    await memSet(kPending, next);

    await memLPush(kRejected, {
      ...found,
      reviewedAt,
      status: "rejected",
      rejectReason: reason || "rejected",
      rejectNote: note || "",
      admin: auth.wallet,
    });

    return noStoreJson({ ok: true, rejected: true, submissionId: sid, driver });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? "reject_error" }, 500);
  }
}
