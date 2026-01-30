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

/**
 * ⚠️ PRODUCTION SAFE
 * This route does NOT write on-chain.
 * It only validates params and returns PDAs for admin/offline execution.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const wallet = String(body.wallet || "");
    const amount = Number(body.amount || 0);

    if (!wallet) {
      return NextResponse.json(
        { ok: false, error: "missing wallet" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        { ok: false, error: "invalid amount" },
        { status: 400 }
      );
    }

    const owner = new PublicKey(wallet);

    // ✅ readonly program (must await)
    const program = await getWaocMissionProgram();

    // ---- PDAs (deterministic, no signing) ----
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

    return NextResponse.json({
      ok: true,

      // input echo
      wallet: owner.toBase58(),
      amount,

      // program info
      missionProgramId: program.programId.toBase58(),
      pointsProgramId: WAOC_POINTS_PROGRAM_ID.toBase58(),

      // derived accounts
      configPda: configPda.toBase58(),
      pointsPda: pointsPda.toBase58(),
      missionSignerPda: missionSignerPda.toBase58(),

      // hint for admin tooling
      note:
        "This endpoint is dry-run only. Execute award on-chain via local admin script.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
