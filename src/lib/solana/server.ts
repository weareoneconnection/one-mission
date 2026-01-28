// src/lib/solana/server.ts
import fs from "fs";
import path from "path";
import { Connection, PublicKey } from "@solana/web3.js";

export const RPC =
  process.env.SOLANA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.devnet.solana.com";

export const connection = new Connection(RPC, "confirmed");

export const PROGRAM_POINTS_ID = new PublicKey(process.env.WAOC_POINTS_PROGRAM_ID!);

export function loadIdlFromFile(which: "waoc_points" | "waoc_mission") {
  const p = path.join(process.cwd(), "idl", `${which}.json`);
  const raw = fs.readFileSync(p, "utf8");
  return JSON.parse(raw);
}
