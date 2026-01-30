// src/lib/solana/config.ts

import { PublicKey } from "@solana/web3.js";

/**
 * Unified env getter
 * - Client: reads NEXT_PUBLIC_*
 * - Server: reads both
 */
function getEnv(name: string): string {
  return process.env[`NEXT_PUBLIC_${name}`] || process.env[name] || "";
}

/**
 * Required env
 * - Server: throw hard error (fail fast)
 * - Client: warn only (avoid white screen)
 */
function must(name: string): string {
  const v = getEnv(name)?.trim();
  if (v) return v;

  if (typeof window === "undefined") {
    throw new Error(`Missing ${name}`);
  } else {
    console.warn(`[config] Missing ${name} (client)`);
    return "";
  }
}

/** Safe PublicKey parser (throws on server, warns on client) */
function mustPubkey(name: string): PublicKey {
  const v = must(name);
  try {
    return new PublicKey(v);
  } catch (e: any) {
    if (typeof window === "undefined") {
      throw new Error(`Invalid ${name}: ${v}`);
    } else {
      console.warn(`[config] Invalid ${name} (client): ${v}`);
      // placeholder to avoid crashing client during hydration;
      // server routes will still fail fast if invalid.
      return PublicKey.default;
    }
  }
}

/* ============================================================
 * Solana RPC
 * ============================================================
 */
export const SOLANA_RPC: string =
  getEnv("SOLANA_RPC_URL") || getEnv("SOLANA_RPC") || "";

/* ============================================================
 * WAOC Programs (Mainnet / Devnet compatible)
 * ============================================================
 * Keep both:
 * - *_ID_STR: for logs / UI
 * - *_PROGRAM_ID: PublicKey for PDA / Anchor
 */
export const WAOC_POINTS_PROGRAM_ID_STR: string = must("WAOC_POINTS_PROGRAM_ID");
export const WAOC_MISSION_PROGRAM_ID_STR: string = must("WAOC_MISSION_PROGRAM_ID");

export const WAOC_POINTS_PROGRAM_ID: PublicKey = mustPubkey("WAOC_POINTS_PROGRAM_ID");
export const WAOC_MISSION_PROGRAM_ID: PublicKey = mustPubkey("WAOC_MISSION_PROGRAM_ID");

/* ============================================================
 * PDA Seeds
 * ⚠️ MUST match on-chain program exactly
 * ============================================================
 */
export const SEED_POINTS = Buffer.from("points"); // points PDA
export const SEED_LEDGER = Buffer.from("ledger"); // optional: history / ledger PDA
export const SEED_CONFIG = Buffer.from("config"); // optional: config PDA

// ✅ compatibility exports (used by award/route.ts)
export const SEED_POINTS_CONFIG = SEED_CONFIG;

// ⚠️ if your on-chain seed differs, change ONLY this string to match.
export const SEED_MISSION_SIGNER = Buffer.from("mission_signer");

/* ============================================================
 * Feature Flags
 * ============================================================
 */
export const MISSION_ONCHAIN_ENABLED: boolean =
  getEnv("MISSION_ONCHAIN_ENABLED") === "1";

/* ============================================================
 * Runtime info (debug / logging)
 * ============================================================
 */
export const IS_CLIENT = typeof window !== "undefined";
export const IS_SERVER = !IS_CLIENT;
