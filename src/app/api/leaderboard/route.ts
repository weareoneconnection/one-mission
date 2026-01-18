import { NextResponse } from "next/server";
import { memStore } from "@/lib/server/memoryStore";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(v: any, d: number) {
  if (v == null || v === "") return d;
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// ✅ 统一：UTC 日/周 key
function todayKeyUTC(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function isoWeekKeyUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thu
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

function noStoreJson(data: any) {
  const res = NextResponse.json(data);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function redisGetInt(redis: any, key: string) {
  const v = await redis.get(key);
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

async function redisHGetInt(redis: any, key: string, field: string) {
  if (typeof redis.hGet === "function") {
    const v = await redis.hGet(key, field);
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  const raw = await redis.get(key);
  if (!raw) return 0;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const n = Number(parsed?.[field] ?? 0);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  } catch {
    return 0;
  }
}

async function redisGetPointsForPeriod(
  redis: any,
  wallet: string,
  period: "all" | "daily" | "weekly"
) {
  if (period === "all") {
    const v2 = await redisHGetInt(redis, `u:${wallet}:profile`, "points_total");
    if (v2) return v2;
    return await redisGetInt(redis, `u:${wallet}:points`);
  }

  if (period === "daily") {
    const d = todayKeyUTC();
    const k = `u:${wallet}:points:daily:${d}`;
    const v = await redis.get(k);
    if (v != null) return Math.trunc(Number(v) || 0);
    return await redisHGetInt(redis, k, "points");
  }

  const w = isoWeekKeyUTC();
  const k = `u:${wallet}:points:weekly:${w}`;
  const v = await redis.get(k);
  if (v != null) return Math.trunc(Number(v) || 0);
  return await redisHGetInt(redis, k, "points");
}

async function redisGetCompletedAll(redis: any, wallet: string) {
  const v2 = await redisHGetInt(redis, `u:${wallet}:profile`, "completed_total");
  if (v2) return v2;
  return await redisGetInt(redis, `u:${wallet}:completed`);
}

async function redisGetUpdatedAt(redis: any, wallet: string) {
  const v2 =
    (await redisHGetInt(redis, `u:${wallet}:profile`, "updatedAt")) ||
    (await redisHGetInt(redis, `u:${wallet}:profile`, "lastSeen")) ||
    (await redisHGetInt(redis, `u:${wallet}:profile`, "last_active"));
  return v2 || 0;
}

function zsetKey(sort: "points" | "completed", period: "all" | "daily" | "weekly") {
  if (sort === "points") {
    if (period === "daily") return `leaderboard:points:daily:${todayKeyUTC()}`;
    if (period === "weekly") return `leaderboard:points:weekly:${isoWeekKeyUTC()}`;
    return "leaderboard:points:all";
  }
  return "leaderboard:completed:all";
}

function legacyZsetKey(sort: "points" | "completed") {
  return sort === "completed" ? "leaderboard:completed" : "leaderboard:points";
}

async function zRangeCompat(redis: any, key: string, start: number, stop: number, rev: boolean) {
  try {
    return (await redis.zRange(key, start, stop, rev ? { REV: true } : undefined)) as string[];
  } catch {
    try {
      return (await redis.zRange(key, start, stop, rev ? { rev: true } : undefined)) as string[];
    } catch {
      try {
        return (await redis.zRange(key, start, stop, rev ? { reverse: true } : undefined)) as string[];
      } catch {
        if (rev && typeof redis.zRevRange === "function") {
          return (await redis.zRevRange(key, start, stop)) as string[];
        }
        return (await redis.zRange(key, start, stop)) as string[];
      }
    }
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const sortRaw = (url.searchParams.get("sort") || "points").toLowerCase();
    const sort = (sortRaw === "completed" ? "completed" : "points") as "points" | "completed";

    const orderRaw = (url.searchParams.get("order") || "desc").toLowerCase();
    const order = (orderRaw === "asc" ? "asc" : "desc") as "asc" | "desc";

    // ✅ 默认 50；并 clamp 1..200
    const limit = Math.max(1, Math.min(200, Math.trunc(num(url.searchParams.get("limit"), 200))));

    const wallet = (url.searchParams.get("wallet") || "").trim();

    const periodRaw = (url.searchParams.get("period") || "all").toLowerCase();
    const safePeriod: "all" | "daily" | "weekly" =
      periodRaw === "daily" || periodRaw === "weekly" ? (periodRaw as any) : "all";

    const driver = String(process.env.LEADERBOARD_STORE_DRIVER || "memory").toLowerCase();
    const rev = order === "desc";

    // =========================
    // MEMORY (dev)
    // =========================
    if (driver === "memory") {
      const rows = Array.from(memStore.leaderboardByWallet.values());

      rows.sort((a, b) => {
        const av = sort === "completed" ? a.completed : a.points;
        const bv = sort === "completed" ? b.completed : b.points;
        const diff = bv - av;
        return order === "desc" ? diff : -diff;
      });

      const top = rows.slice(0, limit);

      let youRank: number | null = null;
      let you: any = null;

      if (wallet) {
        const idx = rows.findIndex((r) => r.wallet === wallet);
        if (idx >= 0) {
          youRank = idx + 1;
          you = rows[idx];
        }
      }

      return noStoreJson({
        ok: true,
        driver: "memory",
        sort,
        order,
        period: safePeriod,
        periodKey:
          safePeriod === "daily" ? todayKeyUTC() : safePeriod === "weekly" ? isoWeekKeyUTC() : "all",
        participants: rows.length,
        top1: top[0] ?? null,
        youRank,
        you,
        rows: top,
        note: safePeriod === "all" ? undefined : "memory driver currently falls back to all-time",
      });
    }

    // =========================
    // REDIS (KV)
    // =========================
    const redis = await getRedis();

    const zkeyV2 = zsetKey(sort, safePeriod);
    const zkeyV1 = legacyZsetKey(sort);

    let participants = Number((await redis.zCard(zkeyV2)) ?? 0);
    let zkeyInUse = zkeyV2;

    if (participants === 0) {
      const p1 = Number((await redis.zCard(zkeyV1)) ?? 0);
      if (p1 > 0) {
        participants = p1;
        zkeyInUse = zkeyV1;
      }
    }

    const members = (await zRangeCompat(redis, zkeyInUse, 0, limit - 1, rev)) as string[];

    const rows = await Promise.all(
      members.map(async (w) => {
        const points =
          sort === "points"
            ? await redisGetPointsForPeriod(redis, w, safePeriod)
            : await redisGetPointsForPeriod(redis, w, "all");

        const completed = await redisGetCompletedAll(redis, w);
        const updatedAt = (await redisGetUpdatedAt(redis, w)) || 0;

        return { wallet: w, points, completed, updatedAt };
      })
    );

    let youRank: number | null = null;
    let you: any = null;

    if (wallet) {
      const rank = rev ? await redis.zRevRank(zkeyInUse, wallet) : await redis.zRank(zkeyInUse, wallet);
      if (typeof rank === "number") {
        youRank = rank + 1;

        const points =
          sort === "points"
            ? await redisGetPointsForPeriod(redis, wallet, safePeriod)
            : await redisGetPointsForPeriod(redis, wallet, "all");

        const completed = await redisGetCompletedAll(redis, wallet);
        const updatedAt = (await redisGetUpdatedAt(redis, wallet)) || 0;

        you = { wallet, points, completed, updatedAt };
      }
    }

    return noStoreJson({
      ok: true,
      driver: "kv",
      sort,
      order,
      period: safePeriod,
      periodKey:
        safePeriod === "daily" ? todayKeyUTC() : safePeriod === "weekly" ? isoWeekKeyUTC() : "all",
      zkey: zkeyInUse,
      participants,
      top1: rows[0] ?? null,
      youRank,
      you,
      rows,
    });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? "leaderboard_error" });
  }
}
