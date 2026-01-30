// src/lib/solana/config.ts

/**
 * Unified env getter
 * - Client: reads NEXT_PUBLIC_*
 * - Server: reads both
 */
function getEnv(name: string): string {
  return (
    process.env[`NEXT_PUBLIC_${name}`] ||
    process.env[name] ||
    ""
  );
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

/* ============================================================
 * Solana RPC
 * ============================================================
 */
export const SOLANA_RPC: string =
  getEnv("SOLANA_RPC_URL") ||
  getEnv("SOLANA_RPC") ||
  "";

/* ============================================================
 * WAOC Programs (Mainnet / Devnet compatible)
 * ============================================================
 */
export const WAOC_POINTS_PROGRAM_ID: string = must("WAOC_POINTS_PROGRAM_ID");
export const WAOC_MISSION_PROGRAM_ID: string = must("WAOC_MISSION_PROGRAM_ID");

/* ============================================================
 * PDA Seeds
 * ⚠️ MUST match on-chain program exactly
 * ============================================================
 */
export const SEED_POINTS = "points";     // points PDA
export const SEED_LEDGER = "ledger";     // optional: history / ledger PDA
export const SEED_CONFIG = "config";     // optional: config PDA
export const SEED_POINTS_CONFIG = SEED_CONFIG; // backward-compatible alias

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
