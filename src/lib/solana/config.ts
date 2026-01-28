import { PublicKey } from "@solana/web3.js";

export const SOLANA_RPC =
  process.env.SOLANA_RPC ?? "https://api.devnet.solana.com";

export const WAOC_POINTS_PROGRAM_ID = new PublicKey(
  process.env.WAOC_POINTS_PROGRAM_ID ??
    "9h862KFbMcoTdvwUZigRSshoWp3E9rGgcoKg1aAxCwuW"
);

export const WAOC_MISSION_PROGRAM_ID = new PublicKey(
  process.env.WAOC_MISSION_PROGRAM_ID ??
    "GfRRu9Rrhx7d25gmQYpkabX3Y6vvKP2KG8ejw7zJ1PJK"
);

export const SEED_POINTS_CONFIG = Buffer.from("points_config");
export const SEED_POINTS = Buffer.from("points");
export const SEED_MISSION_SIGNER = Buffer.from("mission_signer");
