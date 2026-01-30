import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getWaocPointsProgram } from "@/lib/solana/programs";
import { SEED_POINTS, WAOC_POINTS_PROGRAM_ID } from "@/lib/solana/config";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get("wallet");

    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: "missing wallet" },
        { status: 400 }
      );
    }

    const owner = new PublicKey(wallet);

    // ✅ programs.ts 是 async，必须 await
    const program = await getWaocPointsProgram();

    const [pointsPda] = PublicKey.findProgramAddressSync(
      [SEED_POINTS, owner.toBuffer()],
      WAOC_POINTS_PROGRAM_ID
    );

    // points 可能还没 init：fetch 会 throw
    let totalPoints = 0;
    try {
      const acct = await program.account.pointsAccount.fetch(pointsPda);
      totalPoints = Number(
        acct.totalPoints ?? acct.total_points ?? 0
      );
    } catch {
      // not initialized => 0
    }

    return NextResponse.json({
      ok: true,
      wallet: owner.toBase58(),
      pointsPda: pointsPda.toBase58(),
      totalPoints,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
