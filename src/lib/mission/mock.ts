import type { Mission } from "./types";

export const mockMissions: Mission[] = [
  // —— Growth（示例：非链上，可直接完成，但必须绑定钱包）——
  {
    id: "follow-x",
    title: "Follow @waoconnectone",
    description: "Follow the official WAOC account on X.",
    category: "growth",
    status: "available",
    basePoints: 50,
    verifyType: "manual",
  },
  {
    id: "rt-pinned",
    title: "RT pinned tweet",
    description: "Retweet the pinned announcement tweet.",
    category: "growth",
    status: "available",
    basePoints: 100,
    verifyType: "manual",
  },
  {
    id: "join-tg",
    title: "Join WAOC Telegram",
    description: "Join the official WAOC Telegram community.",
    category: "growth",
    status: "available",
    basePoints: 100,
    verifyType: "manual",
  },

  // —— On-chain（必须走 RPC 校验）——
  {
    id: "hold-waoc-10000",
    title: "Hold ≥ 10,000 WAOC",
    description: "Verify you hold at least 10,000 WAOC tokens on Solana.",
    category: "onchain",
    status: "available",
    basePoints: 300,
    verifyType: "wallet",
    onchain: {
      kind: "spl",
      mint: "WAOC_MINT_ADDRESS_HERE",
      minAmount: 10000,
    },
  },
  {
    id: "hold-sol-010",
    title: "Hold ≥ 0.10 SOL",
    description: "Verify you hold at least 0.10 SOL on Solana.",
    category: "onchain",
    status: "available",
    basePoints: 200,
    verifyType: "wallet",
    onchain: {
      kind: "sol",
      minLamports: Math.floor(0.1 * 1_000_000_000),
    },
  },
  {
    id: "own-genesis-nft",
    title: "Own WAOC Genesis NFT",
    description: "Verify you own at least one NFT from the WAOC Genesis collection.",
    category: "onchain",
    status: "available",
    basePoints: 500,
    verifyType: "wallet",
    onchain: {
      kind: "nft",
      collection: "WAOC_GENESIS_COLLECTION_ADDRESS_HERE",
    },
  },
];
