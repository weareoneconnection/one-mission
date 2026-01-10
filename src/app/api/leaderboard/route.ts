import { NextResponse } from "next/server";
import { memStore } from "@/lib/server/memoryStore";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function num(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // Thu
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}

function noStoreJson(data: any) {
  const res = NextResponse.json(data);
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
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
  // fallback: maybe stored as JSON string in GET
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

async function redisGetPointsForPeriod(redis: any, wallet: string, period: "all" | "daily" | "weekly") {
  if (period === "all") {
    // v2 preferred
    const v2 = await redisHGetInt(redis, `u:${wallet}:profile`, "points_total");
    if (v2) return v2;

    // v1 fallback
    return await redisGetInt(redis, `u:${wallet}:points`);
  }

  if (period === "daily") {
    const d = todayKey();
    const k = `u:${wallet}:points:daily:${d}`;
    // support both string or hash field "points"
    const v = await redis.get(k);
    if (v != null) return Math.trunc(Number(v) || 0);
    return await redisHGetInt(redis, k, "points");
  }

  // weekly
  const w = isoWeekKey();
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

function zsetKey(sort: "points" | "completed", period: "all" | "daily" | "weekly") {
  // ✅ new v2 keys
  if (sort === "points") {
    if (period === "daily") return `leaderboard:points:daily:${todayKey()}`;
    if (period === "weekly") return `leaderboard:points:weekly:${isoWeekKey()}`;
    return "leaderboard:points:all";
  }

  // completed：先只做总榜（后续你要也可扩展 daily/weekly）
  return "leaderboard:completed:all";
}

function legacyZsetKey(sort: "points" | "completed") {
  // ✅ old v1 keys
  return sort === "completed" ? "leaderboard:completed" : "leaderboard:points";
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const sort = (url.searchParams.get("sort") || "points") as "points" | "completed";
    const order = (url.searchParams.get("order") || "desc") as "asc" | "desc";
    const limit = Math.max(1, Math.min(200, num(url.searchParams.get("limit"), 50)));
    const wallet = (url.searchParams.get("wallet") || "").trim();

    // ✅ NEW: period
    const period = (url.searchParams.get("period") || "all") as "all" | "daily" | "weekly";
    const safePeriod: "all" | "daily" | "weekly" =
      period === "daily" || period === "weekly" ? period : "all";

    const driver = String(process.env.LEADERBOARD_STORE_DRIVER || "memory").toLowerCase();
    const rev = order === "desc";

    // =========================
    // ✅ MEMORY (dev)
    // =========================
    if (driver === "memory") {
      const rows = Array.from(memStore.leaderboardByWallet.values());

      // Memory store 当前没分 period（你后面我们会在 claim 时一并写）
      // 所以这里：period != all 时先回退 all（不影响本地开发）
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
        periodKey: safePeriod === "daily" ? todayKey() : safePeriod === "weekly" ? isoWeekKey() : "all",
        participants: rows.length,
        top1: top[0] ?? null,
        youRank,
        you,
        rows: top,
        note: safePeriod === "all" ? undefined : "memory driver currently falls back to all-time",
      });
    }

    // =========================
    // ✅ REDIS (KV)
    // =========================
    const redis = await getRedis();

    const zkeyV2 = zsetKey(sort, safePeriod);
    const zkeyV1 = legacyZsetKey(sort);

    // 先尝试 v2 zset，如果不存在/为空则回退 v1
    let participants = Number((await redis.zCard(zkeyV2)) ?? 0);
    let zkeyInUse = zkeyV2;

    if (participants === 0) {
      const p1 = Number((await redis.zCard(zkeyV1)) ?? 0);
      if (p1 > 0) {
        participants = p1;
        zkeyInUse = zkeyV1; // fallback old
      }
    }

    const members = (await redis.zRange(zkeyInUse, 0, limit - 1, { REV: rev })) as string[];

    const rows = await Promise.all(
      members.map(async (w) => {
        const points =
          sort === "points"
            ? await redisGetPointsForPeriod(redis, w, safePeriod)
            : await redisGetPointsForPeriod(redis, w, "all"); // completed榜也把 points 带上，便于展示

        const completed = await redisGetCompletedAll(redis, w);

        return { wallet: w, points, completed, updatedAt: Date.now() };
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

        you = { wallet, points, completed, updatedAt: Date.now() };
      }
    }

    return noStoreJson({
      ok: true,
      driver: "kv",
      sort,
      order,
      period: safePeriod,
      periodKey: safePeriod === "daily" ? todayKey() : safePeriod === "weekly" ? isoWeekKey() : "all",
      zkey: zkeyInUse, // 方便你调试
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
