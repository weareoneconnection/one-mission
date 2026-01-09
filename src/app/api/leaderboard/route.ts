// src/app/api/leaderboard/route.ts
import { NextResponse } from "next/server";
import { memStore } from "@/lib/server/memoryStore";

export const runtime = "nodejs";

function num(v: any, d: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const sort = (url.searchParams.get("sort") || "points") as
      | "points"
      | "completed";
    const order = (url.searchParams.get("order") || "desc") as "asc" | "desc";
    const limit = Math.max(1, Math.min(200, num(url.searchParams.get("limit"), 50)));
    const wallet = (url.searchParams.get("wallet") || "").trim();

    const driver = String(process.env.LEADERBOARD_STORE_DRIVER || "memory");

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
    // ✅ KV（上线再用）
    // =========================
    const { kv } = await import("@vercel/kv");

    // 约定：zset key = "leaderboard:points" / "leaderboard:completed"
    const zkey = sort === "completed" ? "leaderboard:completed" : "leaderboard:points";

    // zrange: 高到低
    const members = (await kv.zrange(zkey, 0, limit - 1, { rev: order === "desc" })) as
      | string[]
      | null;

    const wallets = members ?? [];
    const rows = await Promise.all(
      wallets.map(async (w) => {
        const points = Number((await kv.get(`u:${w}:points`)) ?? 0);
        const completed = Number((await kv.scard(`u:${w}:completedIds`)) ?? 0);
        return { wallet: w, points, completed, updatedAt: Date.now() };
      })
    );

    let youRank: number | null = null;
    let you: any = null;

    if (wallet) {
      const rank = await kv.zrank(zkey, wallet);
      if (typeof rank === "number") {
        youRank = rank + 1;
        const points = Number((await kv.get(`u:${wallet}:points`)) ?? 0);
        const completed = Number((await kv.scard(`u:${wallet}:completedIds`)) ?? 0);
        you = { wallet, points, completed, updatedAt: Date.now() };
      }
    }

    const participants = Number((await kv.zcard(zkey)) ?? 0);

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
