// src/lib/solana/programs.ts
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { PublicKey as PK, Transaction } from "@solana/web3.js";
import {
  SOLANA_RPC,
  WAOC_POINTS_PROGRAM_ID_STR,
  WAOC_MISSION_PROGRAM_ID_STR,
} from "./config";

export type MinimalAnchorWallet = {
  publicKey: PK;
  signTransaction(tx: Transaction): Promise<Transaction>;
  signAllTransactions?(txs: Transaction[]): Promise<Transaction[]>;
};

export function getConnection() {
  const rpc =
    SOLANA_RPC ||
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "";
  if (!rpc) throw new Error("SOLANA_RPC_URL not set");
  return new Connection(rpc, "confirmed");
}

/**
 * ✅ Production-safe readonly provider
 * (NO Wallet import, NO keypair)
 */
export function getReadonlyProvider() {
  const connection = getConnection();
  return new AnchorProvider(connection, {} as any, {
    commitment: "confirmed",
  });
}

let _pointsProgram: any;
let _missionProgram: any;

function asPubkey(id: string, name: string) {
  const v = String(id || "").trim();
  if (!v) throw new Error(`Missing ${name}`);
  return new PublicKey(v);
}

/**
 * ✅ Readonly Points Program (cached)
 */
export async function getWaocPointsProgram(provider = getReadonlyProvider()) {
  if (!_pointsProgram) {
    _pointsProgram = await Program.at(
      asPubkey(WAOC_POINTS_PROGRAM_ID_STR, "WAOC_POINTS_PROGRAM_ID"),
      provider
    );
  }
  return _pointsProgram;
}

/**
 * ✅ Readonly Mission Program (cached)
 */
export async function getWaocMissionProgram(provider = getReadonlyProvider()) {
  if (!_missionProgram) {
    _missionProgram = await Program.at(
      asPubkey(WAOC_MISSION_PROGRAM_ID_STR, "WAOC_MISSION_PROGRAM_ID"),
      provider
    );
  }
  return _missionProgram;
}

/**
 * ✅ Write-enabled provider (wallet signs)
 */
export function getWalletProvider(
  wallet: MinimalAnchorWallet,
  connection?: Connection
) {
  const conn = connection ?? getConnection();
  return new AnchorProvider(conn, wallet as any, { commitment: "confirmed" });
}

/**
 * ✅ Write-enabled Points Program (NOT cached!)
 * ⚠️ Important: do NOT cache, otherwise the first wallet provider gets stuck.
 */
export async function getWaocPointsProgramWithWallet(
  wallet: MinimalAnchorWallet,
  connection?: Connection
) {
  const provider = getWalletProvider(wallet, connection);
  const program = await Program.at(
    asPubkey(WAOC_POINTS_PROGRAM_ID_STR, "WAOC_POINTS_PROGRAM_ID"),
    provider
  );
  return program;
}
