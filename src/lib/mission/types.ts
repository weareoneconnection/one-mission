export type MissionCategory = "growth" | "onchain" | "contribution" | "mindfulness";
export type MissionStatus = "locked" | "available" | "completed" | "cooldown";

export type VerifyType = "x" | "telegram" | "wallet" | "manual";

export type OnchainRequirement =
  | { kind: "sol"; minLamports: number } // 1 SOL = 1_000_000_000 lamports
  | { kind: "spl"; mint: string; minAmount: number } // SPL token amount
  | { kind: "nft"; collection: string }; // NFT collection id/name (mock)

export type Mission = {
  id: string;
  title: string;
  description?: string;
  category: MissionCategory;
  basePoints: number;
  status: MissionStatus;
  verifyType: VerifyType;

  // ✅ only for on-chain missions
  onchain?: OnchainRequirement;
};
