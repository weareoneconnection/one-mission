import type { Mission } from "./types";

// ✅ 让 mint/collection 默认从环境变量拿（你 verify-onchain 里也这么做）
//    这里写 "ENV" 只是占位，真正校验仍由 /api/verify-onchain 使用 env
const WAOC_MINT_PLACEHOLDER = "ENV:WAOC_MINT";
const WAOC_COLLECTION_PLACEHOLDER = "ENV:WAOC_GENESIS_COLLECTION_MINT";

export const mockMissions: Mission[] = [
  // =========================
  // DAILY (每 00:00 UTC 重置)
  // =========================
  {
    id: "daily:checkin",
    title: "Daily Check-in",
    description: "Claim your daily points to keep your streak active.",
    category: "growth",
    status: "available",
    basePoints: 20,
    verifyType: "manual",
  },
  {
    id: "daily:share",
    title: "Daily Share",
    description: "Share WAOC today (X / Telegram / other).",
    category: "growth",
    status: "available",
    basePoints: 10,
    verifyType: "manual",
  },
  {
    id: "daily:comment",
    title: "Daily Comment",
    description: "Comment “ONE” under WAOC post (or in community).",
    category: "growth",
    status: "available",
    basePoints: 10,
    verifyType: "manual",
  },

  // =========================
  // WEEKLY (ISO week 重置)
  // =========================
  {
    id: "weekly:invite3",
    title: "Weekly Invite ×3",
    description: "Invite 3 new members to the community this week.",
    category: "growth",
    status: "available",
    basePoints: 60,
    verifyType: "manual",
  },
  {
    id: "weekly:vote",
    title: "Weekly Vote / Feedback",
    description: "Participate in the weekly poll or feedback mission.",
    category: "growth",
    status: "available",
    basePoints: 50,
    verifyType: "manual",
  },

  // =========================
  // ONCE (一次性任务)
  // =========================
  {
    id: "once:follow-x",
    title: "Follow @waoconnectone",
    description: "Follow the official WAOC account on X.",
    category: "growth",
    status: "available",
    basePoints: 50,
    verifyType: "manual",
  },
  {
    id: "once:rt-pinned",
    title: "RT pinned tweet",
    description: "Retweet the pinned announcement tweet.",
    category: "growth",
    status: "available",
    basePoints: 100,
    verifyType: "manual",
  },
  {
    id: "once:join-tg",
    title: "Join WAOC Telegram",
    description: "Join the official WAOC Telegram community.",
    category: "growth",
    status: "available",
    basePoints: 100,
    verifyType: "manual",
  },

  // =========================
  // ON-CHAIN (通常建议 once)
  // =========================
  {
    id: "once:hold-waoc-10000",
    title: "Hold ≥ 10,000 WAOC",
    description: "Verify you hold at least 10,000 WAOC tokens on Solana.",
    category: "onchain",
    status: "available",
    basePoints: 300,
    verifyType: "wallet",
    onchain: {
      kind: "spl",
      // ✅ 不要在这里写死，留给后端 env
      mint: WAOC_MINT_PLACEHOLDER,
      minAmount: 10000,
    },
  },
  {
    id: "once:hold-sol-010",
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
    id: "once:own-genesis-nft",
    title: "Own WAOC Genesis NFT",
    description: "Verify you own at least one NFT from the WAOC Genesis collection.",
    category: "onchain",
    status: "available",
    basePoints: 500,
    verifyType: "wallet",
    onchain: {
      kind: "nft",
      // ✅ 不要在这里写死，留给后端 env
      collection: WAOC_COLLECTION_PLACEHOLDER,
    },
  },
];
