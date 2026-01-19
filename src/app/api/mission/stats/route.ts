import { NextResponse } from "next/server";
import { getRedis } from "@/lib/server/redis";

type Driver = "memory" | "kv";

function pickDriver(): Driver {
  const v = String(process.env.MISSION_STORE_DRIVER || "memory").toLowerCase();
  return v === "kv" ? "kv" : "memory";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayKeyUTC(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
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

// ---- kv driver (prod) ----
async function kvClient() {
  return getRedis();
}

function asInt(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

async function redisGetInt(redis: any, key: string) {
  const v = await redis.get(key);
  return asInt(v, 0);
}

async function redisHGet(redis: any, key: string, field: string) {
  if (typeof redis.hGet === "function") return await redis.hGet(key, field);
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return parsed?.[field] ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const wallet = String(url.searchParams.get("wallet") || "").trim();

    if (!wallet) {
      return NextResponse.json({ ok: false, error: "missing wallet query (?wallet=...)" }, { status: 400 });
    }

    const driver = pickDriver();

    // legacy keys (v1)
    const kOldPoints = `u:${wallet}:points`;
    const kOldCompleted = `u:${wallet}:completed`;

    // new keys (v2)
    const kProfile = `u:${wallet}:profile`;

    if (driver === "kv") {
      const redis = await kvClient();

      const points_total = asInt(await redisHGet(redis, kProfile, "points_total"), 0);
      const completed_total = asInt(await redisHGet(redis, kProfile, "completed_total"), 0);
      const unique_once_total = asInt(await redisHGet(redis, kProfile, "unique_once_total"), 0);

      const streak_count = asInt(await redisHGet(redis, kProfile, "streak_count"), 0);
      const streak_last_date = String((await redisHGet(redis, kProfile, "streak_last_date")) || "");
      const updatedAt = asInt(await redisHGet(redis, kProfile, "updatedAt"), 0);

      const legacyPoints = await redisGetInt(redis, kOldPoints);
      const legacyCompleted = await redisGetInt(redis, kOldCompleted);

      const points = points_total || legacyPoints;
      const completed = completed_total || legacyCompleted;

      return NextResponse.json({
        ok: true,
        wallet,
        driver,

        points,
        completed,

        totalPoints: points,
        completedCount: completed,

        uniqueCompleted: unique_once_total,
        completedMeaning: "total_claims",
        uniqueMeaning: "unique_once",

        streak: {
          count: streak_count,
          lastDate: streak_last_date,
          active: Boolean(streak_last_date) && streak_last_date === todayKeyUTC(),
        },

        updatedAt,
      });
    }

    // memory driver
    const profile = (await memGet(kProfile)) ?? {};
    const points_total = asInt(profile?.points_total, 0);
    const completed_total = asInt(profile?.completed_total, 0);
    const unique_once_total = asInt(profile?.unique_once_total, 0);

    const streak_count = asInt(profile?.streak_count, 0);
    const streak_last_date = String(profile?.streak_last_date || "");
    const updatedAt = asInt(profile?.updatedAt, 0);

    const legacyPoints = asInt(await memGet(kOldPoints), 0);
    const legacyCompleted = asInt(await memGet(kOldCompleted), 0);

    const points = points_total || legacyPoints;
    const completed = completed_total || legacyCompleted;

    return NextResponse.json({
      ok: true,
      wallet,
      driver: "memory",

      points,
      completed,

      totalPoints: points,
      completedCount: completed,

      uniqueCompleted: unique_once_total,
      completedMeaning: "total_claims",
      uniqueMeaning: "unique_once",

      streak: {
        count: streak_count,
        lastDate: streak_last_date,
        active: Boolean(streak_last_date) && streak_last_date === todayKeyUTC(),
      },

      updatedAt,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "stats_error" }, { status: 500 });
  }
}
