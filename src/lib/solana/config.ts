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
 * Detect Next build phase (avoid crashing during "collect page data")
 */
function isNextBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/**
 * Required env
 * - Runtime Server: throw hard error (fail fast)
 * - Build Server: warn only (avoid build failure when env not injected yet)
 * - Client: warn only (avoid white screen)
 */
function must(name: string): string {
  const v = getEnv(name)?.trim();
  if (v) return v;

  if (typeof window === "undefined") {
    if (isNextBuildPhase()) {
      console.warn(`[config] Missing ${name} during Next build phase`);
      return "";
    }
    throw new Error(`Missing ${name}`);
  }

  console.warn(`[config] Missing ${name} (client)`);
  return "";
}

/** Safe PublicKey parser */
function mustPubkey(name: string): PublicKey {
  const v = must(name);

  // build phase may return ""
  if (!v) return PublicKey.default;

  try {
    return new PublicKey(v);
  } catch {
    if (typeof window === "undefined") {
      if (isNextBuildPhase()) {
        console.warn(`[config] Invalid ${name} during Next build phase: ${v}`);
        return PublicKey.default;
      }
      throw new Error(`Invalid ${name}: ${v}`);
    }
    console.warn(`[config] Invalid ${name} (client): ${v}`);
    return PublicKey.default;
  }
}

/* ============================================================
 * Solana RPC
 * ============================================================
 */
export const SOLANA_RPC: string =
  getEnv("SOLANA_RPC_URL") || getEnv("SOLANA_RPC") || "";

/* ============================================================
 * WAOC Programs
 * Provide both string + PublicKey forms for compatibility
 * ============================================================
 */
export const WAOC_POINTS_PROGRAM_ID_STR: string = must("WAOC_POINTS_PROGRAM_ID");
export const WAOC_MISSION_PROGRAM_ID_STR: string = must("WAOC_MISSION_PROGRAM_ID");

export const WAOC_POINTS_PROGRAM_ID: PublicKey = mustPubkey("WAOC_POINTS_PROGRAM_ID");
export const WAOC_MISSION_PROGRAM_ID: PublicKey = mustPubkey("WAOC_MISSION_PROGRAM_ID");

/* ============================================================
 * PDA Seeds
 * ⚠️ MUST match on-chain program exactly
 * Use Buffer for findProgramAddressSync
 * ============================================================
 */
export const SEED_POINTS = Buffer.from("points");
export const SEED_LEDGER = Buffer.from("ledger");
export const SEED_CONFIG = Buffer.from("config");

// ✅ canonical (new)
export const SEED_POINTS_CONFIG = SEED_CONFIG;

// ✅ compatibility aliases (old imports might use different names)
export const SEED_POINTS_CFG = SEED_POINTS_CONFIG;
export const SEED_CONFIG_POINTS = SEED_POINTS_CONFIG;

// mission signer PDA seed
export const SEED_MISSION_SIGNER = Buffer.from("mission_signer");

/* ============================================================
 * Feature Flags
 * ============================================================
 */
export const MISSION_ONCHAIN_ENABLED: boolean =
  getEnv("MISSION_ONCHAIN_ENABLED") === "1";

/* ============================================================
 * Runtime info
 * ============================================================
 */
export const IS_CLIENT = typeof window !== "undefined";
export const IS_SERVER = !IS_CLIENT;
