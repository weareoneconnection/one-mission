import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = process.env.REDIS_URL || "";
  return NextResponse.json({
    hasRedisUrl: Boolean(url),
    redisUrlHead: url.slice(0, 20),
    redisHost: url.split("@")[1]?.split(":")[0] || "",
    driver: process.env.MISSION_STORE_DRIVER || "",
  });
}
