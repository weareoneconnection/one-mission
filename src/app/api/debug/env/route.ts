import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json({
    hasRedisUrl: !!process.env.REDIS_URL,
    redisUrlHead: process.env.REDIS_URL ? String(process.env.REDIS_URL).slice(0, 20) : null,
    redisHost: process.env.REDIS_URL ? String(process.env.REDIS_URL).split("@").pop()?.split("/")[0] : null,

    // ✅ solana + programs
    SOLANA_RPC: process.env.SOLANA_RPC ?? null,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL ?? null,
    WAOC_MISSION_PROGRAM_ID: process.env.WAOC_MISSION_PROGRAM_ID ?? null,
    WAOC_POINTS_PROGRAM_ID: process.env.WAOC_POINTS_PROGRAM_ID ?? null,
    MISSION_ONCHAIN_ENABLED: process.env.MISSION_ONCHAIN_ENABLED ?? null,

    // drivers
    driver: process.env.MISSION_STORE_DRIVER ?? null,
  });
}
