// src/lib/solana/anchor.ts
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "fs";
import path from "path";

// ✅ 你放 IDL 的路径：one-mission/idl/waoc_mission.json & waoc_points.json
const IDL_MISSION_PATH = path.join(process.cwd(), "idl", "waoc_mission.json");
const IDL_POINTS_PATH = path.join(process.cwd(), "idl", "waoc_points.json");

function loadIdl(p: string) {
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}

/**
 * ✅ Node server 用的 wallet（从本机 keypair 或 env 读取）
 * 方案 A：默认读 ~/.config/solana/id.json
 * 方案 B：设置 env SOLANA_KEYPAIR=/abs/path/to/keypair.json
 */
function loadKeypair(): Keypair {
  const kpPath =
    process.env.SOLANA_KEYPAIR ||
    path.join(process.env.HOME || "", ".config", "solana", "id.json");
  const secret = JSON.parse(fs.readFileSync(kpPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

class NodeWallet implements anchor.Wallet {
  constructor(readonly payer: Keypair) {}
  get publicKey() {
    return this.payer.publicKey;
  }
  async signTransaction(tx: any) {
    tx.partialSign(this.payer);
    return tx;
  }
  async signAllTransactions(txs: any[]) {
    txs.forEach((t) => t.partialSign(this.payer));
    return txs;
  }
}

export function getProvider() {
  const rpc =
    process.env.SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    "https://api.devnet.solana.com";

  const connection = new Connection(rpc, "confirmed");
  const wallet = new NodeWallet(loadKeypair());

  return new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
}

/**
 * ✅ 关键：你当前 anchor 版本是 2 参数 Program(idl, provider)
 * 所以必须把 programId 写进 idl.metadata.address
 */
function attachAddressToIdl(idl: any, programId: PublicKey) {
  if (!idl.metadata) idl.metadata = {};
  idl.metadata.address = programId.toBase58();
  return idl;
}

export function getWaocMissionProgram(provider: anchor.AnchorProvider) {
  const programId = new PublicKey(process.env.WAOC_MISSION_PROGRAM_ID!);
  const idl = attachAddressToIdl(loadIdl(IDL_MISSION_PATH), programId);

  // ✅ 两参构造（符合你的 anchor 版本）
  return new anchor.Program(idl as anchor.Idl, provider);
}

export function getWaocPointsProgram(provider: anchor.AnchorProvider) {
  const programId = new PublicKey(process.env.WAOC_POINTS_PROGRAM_ID!);
  const idl = attachAddressToIdl(loadIdl(IDL_POINTS_PATH), programId);

  return new anchor.Program(idl as anchor.Idl, provider);
}
