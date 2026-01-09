import { NextResponse } from "next/server";
import { memStore } from "@/lib/server/memoryStore";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";

function num(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

async function redisGetInt(redis: any, key: string) {
  const v = await redis.get(key);
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const sort = (url.searchParams.get("sort") || "points") as "points" | "completed";
    const order = (url.searchParams.get("order") || "desc") as "asc" | "desc";
    const limit = Math.max(1, Math.min(200, num(url.searchParams.get("limit"), 50)));
    const wallet = (url.searchParams.get("wallet") || "").trim();

    const driver = String(process.env.LEADERBOARD_STORE_DRIVER || "memory").toLowerCase();

    // =========================
    // ✅ MEMORY
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

      return NextResponse.json({
        ok: true,
        driver: "memory",
        sort,
        order,
        participants: rows.length,
        top1: top[0] ?? null,
        youRank,
        you,
        rows: top,
      });
    }

    // =========================
    // ✅ REDIS (KV)
    // =========================
    const redis = await getRedis();

    const zkey = sort === "completed" ? "leaderboard:completed" : "leaderboard:points";
    const rev = order === "desc";

    // ✅ node-redis v4: zRange(key, start, stop, { REV: true })
    const members = (await redis.zRange(zkey, 0, limit - 1, { REV: rev })) as string[];

    const rows = await Promise.all(
      members.map(async (w) => {
        const points = await redisGetInt(redis, `u:${w}:points`);
        const completed = await redisGetInt(redis, `u:${w}:completed`);
        return { wallet: w, points, completed, updatedAt: Date.now() };
      })
    );

    let youRank: number | null = null;
    let you: any = null;

    if (wallet) {
      // ✅ node-redis v4: zRank / zRevRank
      const rank = rev ? await redis.zRevRank(zkey, wallet) : await redis.zRank(zkey, wallet);
      if (typeof rank === "number") {
        youRank = rank + 1;
        const points = await redisGetInt(redis, `u:${wallet}:points`);
        const completed = await redisGetInt(redis, `u:${wallet}:completed`);
        you = { wallet, points, completed, updatedAt: Date.now() };
      }
    }

    const participants = Number((await redis.zCard(zkey)) ?? 0);

    return NextResponse.json({
      ok: true,
      driver: "kv",
      sort,
      order,
      participants,
      top1: rows[0] ?? null,
      youRank,
      you,
      rows,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "leaderboard_error" },
      { status: 500 }
    );
  }
}
