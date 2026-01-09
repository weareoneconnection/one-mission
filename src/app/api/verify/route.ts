import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";

type Driver = "memory" | "kv";

type VerifyBody = {
  missionId?: string;
  id?: string;

  wallet?: string;
  walletAddress?: string;
  address?: string;

  points?: number;
  basePoints?: number;
};

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

// ---- memory store (dev) ----
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
async function memIncrBy(key: string, n: number) {
  const cur = Number(getMemDB().kv.get(key) ?? 0);
  const next = cur + n;
  getMemDB().kv.set(key, next);
  return next;
}
async function memIncr(key: string) {
  return memIncrBy(key, 1);
}

// ---- kv driver (prod) ----
async function kvClient() {
  return getRedis();
}

function asInt(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.trunc(x) : fallback;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as VerifyBody;

    const missionId = String(body.missionId || body.id || "").trim();
    const wallet = String(body.wallet || body.walletAddress || body.address || "").trim();
    const points = asInt(body.points ?? body.basePoints, 0);

    if (!missionId) {
      return NextResponse.json(
        { ok: false, error: "missing missionId (missionId/id)" },
        { status: 400 }
      );
    }
    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: "missing wallet (wallet/walletAddress/address)" },
        { status: 400 }
      );
    }

    const driver = pickDriver();

    const kDone = `mission:${missionId}:${wallet}`;
    const kPoints = `u:${wallet}:points`;
    const kCompleted = `u:${wallet}:completed`;

    // 1) 防重复加分
    const already =
      driver === "kv" ? await (await kvClient()).get(kDone) : await memGet(kDone);

    if (already) {
      const curPoints =
        driver === "kv"
          ? Number((await (await kvClient()).get(kPoints)) ?? 0)
          : Number((await memGet(kPoints)) ?? 0);

      const curCompleted =
        driver === "kv"
          ? Number((await (await kvClient()).get(kCompleted)) ?? 0)
          : Number((await memGet(kCompleted)) ?? 0);

      return NextResponse.json({
        ok: true,
        verified: true,
        alreadyVerified: true,
        missionId,
        wallet,
        pointsAdded: 0,
        totalPoints: curPoints,
        completed: curCompleted,
        driver,
      });
    }

    // 2) 记为已完成 + 累加
    if (driver === "kv") {
      const kv = await kvClient();

      // ✅ node-redis 的 set 不接受 boolean：用 "1"
      await kv.set(kDone, "1");

      if (points > 0) await kv.incrBy(kPoints, points); // ✅ incrBy
      await kv.incr(kCompleted);
    } else {
      await memSet(kDone, true);
      if (points > 0) await memIncrBy(kPoints, points);
      await memIncr(kCompleted);
    }

    const totalPoints =
      driver === "kv"
        ? Number((await (await kvClient()).get(kPoints)) ?? 0)
        : Number((await memGet(kPoints)) ?? 0);

    const completed =
      driver === "kv"
        ? Number((await (await kvClient()).get(kCompleted)) ?? 0)
        : Number((await memGet(kCompleted)) ?? 0);

    return NextResponse.json({
      ok: true,
      verified: true,
      missionId,
      wallet,
      pointsAdded: points,
      totalPoints,
      completed,
      driver,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "verify_error" },
      { status: 500 }
    );
  }
}
