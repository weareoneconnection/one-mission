import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getWaocMissionProgram } from "@/lib/solana/programs";
import {
  SEED_POINTS_CONFIG,
  SEED_POINTS,
  SEED_MISSION_SIGNER,
  WAOC_POINTS_PROGRAM_ID,
  WAOC_MISSION_PROGRAM_ID,
} from "@/lib/solana/config";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const wallet = String(body.wallet || "");
    const amount = Number(body.amount || 0);

    if (!wallet) return NextResponse.json({ ok: false, error: "missing wallet" }, { status: 400 });
    if (!Number.isFinite(amount) || amount <= 0)
      return NextResponse.json({ ok: false, error: "invalid amount" }, { status: 400 });

    const owner = new PublicKey(wallet);
    const program = getWaocMissionProgram();

    const [configPda] = PublicKey.findProgramAddressSync(
      [SEED_POINTS_CONFIG],
      WAOC_POINTS_PROGRAM_ID
    );

    const [pointsPda] = PublicKey.findProgramAddressSync(
      [SEED_POINTS, owner.toBuffer()],
      WAOC_POINTS_PROGRAM_ID
    );

    const [missionSignerPda] = PublicKey.findProgramAddressSync(
      [SEED_MISSION_SIGNER],
      WAOC_MISSION_PROGRAM_ID
    );

    const tx = await program.methods
      .awardPoints(new (program.provider as any).BN(amount))
      .accounts({
        waocPointsProgram: WAOC_POINTS_PROGRAM_ID,
        pointsConfig: configPda,
        points: pointsPda,
        owner: owner,
        missionSigner: missionSignerPda,
        admin: program.provider.wallet.publicKey,
      })
      .rpc();

    return NextResponse.json({
      ok: true,
      tx,
      wallet: owner.toBase58(),
      amount,
      configPda: configPda.toBase58(),
      pointsPda: pointsPda.toBase58(),
      missionSignerPda: missionSignerPda.toBase58(),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
