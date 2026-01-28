import { NextResponse } from "next/server";
import { fetchPointsAccount } from "@/lib/solana/pointsReader";
import { getRedis } from "@/lib/server/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function asInt(v: any, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = String(searchParams.get("wallet") || "").trim();
    if (!wallet) return NextResponse.json({ ok: false, error: "missing wallet" }, { status: 400 });

    const redis = await getRedis();

    // 1) onchain points
    const onchain = await fetchPointsAccount(wallet); 
    // { exists, pda, owner, total, raw, ... } 你现有实现返回的结构

    // 2) offchain total（你 kv profile 里就是 points_total）
    const profKey = `u:${wallet}:profile`;
    let offchainTotal = 0;
    if (typeof redis.hGet === "function") {
      offchainTotal = asInt(await redis.hGet(profKey, "points_total"), 0);
    } else {
      // fallback：如果你某些环境不是 hash
      const raw = await redis.get(profKey);
      try {
        const obj = raw ? JSON.parse(raw) : {};
        offchainTotal = asInt(obj?.points_total, 0);
      } catch {
        offchainTotal = 0;
      }
    }

    // 3) last onchain receipt（来自 approve 写入的 KV）
    let last: any = null;
    try {
      const s = await redis.get(`onchain:last:${wallet}`);
      last = s ? JSON.parse(s) : null;
    } catch {
      last = null;
    }

    const onchainTotal = asInt(onchain?.total, 0);
    const diff = offchainTotal - onchainTotal;

    return NextResponse.json({
      ok: true,
      wallet,

      onchain: {
        exists: !!onchain?.exists,
        pda: onchain?.pda || null,
        total: String(onchainTotal),
        updatedAt: onchain?.raw?.updated_at ?? null,
        last: last
          ? {
              ts: last.ts ?? null,
              tx: last.tx ?? null,
              amount: last.amount ?? null,
              missionId: last.missionId ?? null,
              periodKey: last.periodKey ?? null,
              admin: last.admin ?? null,
            }
          : null,
      },

      offchain: {
        total: String(offchainTotal),
      },

      consistency: {
        ok: diff === 0,
        diff: String(diff),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
