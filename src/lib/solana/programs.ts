import * as anchor from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import {
  SOLANA_RPC,
  WAOC_POINTS_PROGRAM_ID,
  WAOC_MISSION_PROGRAM_ID,
} from "./config";
import { loadAdminKeypair } from "./admin";

import waocPointsIdl from "../../../idl/waoc_points.json";
import waocMissionIdl from "../../../idl/waoc_mission.json";

export function getConnection() {
  return new Connection(SOLANA_RPC, "confirmed");
}

export function getProvider() {
  const connection = getConnection();
  const admin = loadAdminKeypair();
  const wallet = new anchor.Wallet(admin);
  return new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

// ✅ 关键：any 化，避免 TS 推导爆炸
export function getWaocPointsProgram(provider = getProvider()) {
  return new anchor.Program(
    waocPointsIdl as any,
    WAOC_POINTS_PROGRAM_ID,
    provider
  ) as any;
}

export function getWaocMissionProgram(provider = getProvider()) {
  return new anchor.Program(
    waocMissionIdl as any,
    WAOC_MISSION_PROGRAM_ID,
    provider
  ) as any;
}
