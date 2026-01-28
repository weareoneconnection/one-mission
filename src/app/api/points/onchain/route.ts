// src/app/api/points/onchain/route.ts
import { NextResponse } from "next/server";
import { fetchPointsAccount } from "@/lib/solana/pointsReader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = String(searchParams.get("wallet") || "").trim();
    if (!wallet) return NextResponse.json({ ok: false, error: "missing wallet" }, { status: 400 });

    const r = await fetchPointsAccount(wallet);
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
