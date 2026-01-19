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
    // =========================
  // NEW: GROWTH (长期可跑)
  // =========================
  {
    id: "daily:read-update",
    title: "Read Daily Update",
    description: "Read the daily WAOC update (news / announcement / pinned message).",
    category: "growth",
    status: "available",
    basePoints: 10,
    verifyType: "manual",
  },
  {
    id: "weekly:share3",
    title: "Weekly Share ×3",
    description: "Share WAOC 3 times this week (X / Telegram / other).",
    category: "growth",
    status: "available",
    basePoints: 40,
    verifyType: "manual",
  },
  {
    id: "weekly:help1",
    title: "Weekly Help 1 Newcomer",
    description: "Help at least 1 newcomer in the community this week (answer / guide).",
    category: "growth",
    status: "available",
    basePoints: 60,
    verifyType: "manual",
  },
  {
    id: "weekly:post1",
    title: "Weekly Post",
    description: "Create one WAOC post this week (short post is fine).",
    category: "growth",
    status: "available",
    basePoints: 70,
    verifyType: "manual",
  },
  {
    id: "once:complete-profile",
    title: "Complete Mission Profile",
    description: "Complete your One Mission profile (basic info + links).",
    category: "growth",
    status: "available",
    basePoints: 80,
    verifyType: "manual",
  },
  {
    id: "once:join-discord-or-alt",
    title: "Join WAOC Community Hub",
    description: "Join the community hub (Discord or alternative official hub).",
    category: "growth",
    status: "available",
    basePoints: 120,
    verifyType: "manual",
  },
  {
    id: "once:publish-thread-lite",
    title: "Publish a WAOC Mini Thread",
    description: "Publish a mini thread (5–8 lines) explaining WAOC in your own words.",
    category: "growth",
    status: "available",
    basePoints: 180,
    verifyType: "manual",
  },
  {
    id: "once:invite10-total",
    title: "Invite 10 Members (Total)",
    description: "Invite a total of 10 members over time (cumulative milestone).",
    category: "growth",
    status: "available",
    basePoints: 250,
    verifyType: "manual",
  },

  // =========================
  // NEW: CONTRIBUTION (普通用户可做｜三年稳定)
  // =========================
  {
    id: "daily:contrib-note",
    title: "Daily Contribution Note",
    description: "Write one small improvement idea or observation today (short is ok).",
    category: "contribution",
    status: "available",
    basePoints: 10,
    verifyType: "manual",
  },
  {
    id: "weekly:report1",
    title: "Weekly Issue / Bug Report",
    description: "Report 1 issue, bug, or UX pain point this week (clear description).",
    category: "contribution",
    status: "available",
    basePoints: 60,
    verifyType: "manual",
  },
  {
    id: "weekly:suggest1",
    title: "Weekly Improvement Suggestion",
    description: "Submit 1 actionable suggestion this week (feature / copy / flow).",
    category: "contribution",
    status: "available",
    basePoints: 60,
    verifyType: "manual",
  },
  {
    id: "weekly:faq1",
    title: "Weekly FAQ Contribution",
    description: "Add or improve 1 FAQ entry this week (question + short answer).",
    category: "contribution",
    status: "available",
    basePoints: 80,
    verifyType: "manual",
  },
  {
    id: "weekly:translation1",
    title: "Weekly Translation (Small)",
    description: "Translate a short WAOC message (5–10 lines) to another language.",
    category: "contribution",
    status: "available",
    basePoints: 90,
    verifyType: "manual",
  },
  {
    id: "weekly:content-review1",
    title: "Weekly Content Review",
    description: "Review 1 piece of WAOC content and suggest improvements (clarity / tone).",
    category: "contribution",
    status: "available",
    basePoints: 90,
    verifyType: "manual",
  },
  {
    id: "once:first-feedback",
    title: "First Feedback Submitted",
    description: "Submit your first feedback with clear steps or examples.",
    category: "contribution",
    status: "available",
    basePoints: 120,
    verifyType: "manual",
  },
  {
    id: "once:five-feedback",
    title: "5 Feedback Milestone",
    description: "Reach a total of 5 feedback submissions over time.",
    category: "contribution",
    status: "available",
    basePoints: 220,
    verifyType: "manual",
  },
  {
    id: "once:community-helper",
    title: "Community Helper Badge",
    description: "Provide consistent community help (verified by moderators).",
    category: "contribution",
    status: "available",
    basePoints: 350,
    verifyType: "manual",
  },

  // =========================
  // NEW: MINDFULNESS (差异化主线｜三年稳定)
  // =========================
  {
    id: "daily:breath-5m",
    title: "Breath Practice (5 min)",
    description: "Do a 5-minute breathing practice today.",
    category: "mindfulness",
    status: "available",
    basePoints: 15,
    verifyType: "manual",
  },
  {
    id: "daily:meditate-5m",
    title: "Meditate (5 min)",
    description: "Do a 5-minute meditation session today.",
    category: "mindfulness",
    status: "available",
    basePoints: 20,
    verifyType: "manual",
  },
  {
    id: "weekly:meditate-3x",
    title: "Meditate 3× This Week",
    description: "Complete 3 meditation sessions this week.",
    category: "mindfulness",
    status: "available",
    basePoints: 90,
    verifyType: "manual",
  },
  {
    id: "weekly:meditate-60m",
    title: "Meditation 60 Minutes",
    description: "Accumulate 60 minutes of meditation this week.",
    category: "mindfulness",
    status: "available",
    basePoints: 120,
    verifyType: "manual",
  },
  {
    id: "once:mindfulness-onboard",
    title: "Mindfulness Onboarding",
    description: "Complete the mindfulness onboarding (intro + first session).",
    category: "mindfulness",
    status: "available",
    basePoints: 120,
    verifyType: "manual",
  },
  {
    id: "once:streak-7",
    title: "7-Day Streak",
    description: "Achieve a 7-day daily streak (any daily mission).",
    category: "mindfulness",
    status: "available",
    basePoints: 250,
    verifyType: "manual",
  },

  // =========================
  // NEW: ON-CHAIN (追加但不推翻旧链上)
  // =========================
  {
    id: "once:hold-waoc-100000",
    title: "Hold ≥ 100,000 WAOC",
    description: "Verify you hold at least 100,000 WAOC tokens on Solana.",
    category: "onchain",
    status: "available",
    basePoints: 600,
    verifyType: "wallet",
    onchain: {
      kind: "spl",
      mint: WAOC_MINT_PLACEHOLDER,
      minAmount: 100000,
    },
  },
  {
    id: "once:hold-waoc-1000000",
    title: "Hold ≥ 1,000,000 WAOC",
    description: "Verify you hold at least 1,000,000 WAOC tokens on Solana.",
    category: "onchain",
    status: "available",
    basePoints: 1200,
    verifyType: "wallet",
    onchain: {
      kind: "spl",
      mint: WAOC_MINT_PLACEHOLDER,
      minAmount: 1000000,
    },
  },
];
