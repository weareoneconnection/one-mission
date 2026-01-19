"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Mission } from "./types";
import { mockMissions } from "./mock";
import { verifyOnchainMission } from "@/lib/onchain/verifyOnchain";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

type ProofPayload = {
  text?: string; // 用户描述
  url?: string;  // 证明链接（tweet / tg msg / github / etc）
};

type MissionState = {
  missions: Mission[];
  points: number;
  completedCount: number;

  walletAddress: string | null;
  connecting: boolean;
  connected: boolean;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;

  verifyingId: string | null;
  errors: Record<string, string | undefined>;

  // ✅ 兼容：仍然可以 verify(id)
  // ✅ 新增：verify(id, proof)
  verify: (id: string, proof?: ProofPayload) => void;

  reset: () => void;
  resetAll: () => void;
};

const MissionContext = createContext<MissionState | null>(null);

// ✅ 任务定义（不写 completed）
const baseMissions: Mission[] = mockMissions.map((m) => ({
  ...m,
  status: m.status === "completed" ? "available" : m.status,
}));

/** -----------------------------
 *  Response Types
 * ------------------------------ */
type StatsResponse = {
  ok: boolean;
  wallet: string;
  points?: number;
  totalPoints?: number;
  completed?: number;
  completedCount?: number;
  points_total?: number;
  completed_total?: number;
  error?: string;
};

type VerifyResponse = {
  ok: boolean;
  wallet: string;
  missionId: string;
  points?: number;
  totalPoints?: number;
  completed?: number;
  completedCount?: number;
  duplicated?: boolean;
  alreadyVerified?: boolean;
  pointsAdded?: number;
  error?: string;
};

type SubmitResponse = {
  ok: boolean;
  wallet: string;
  missionId: string;
  period?: "once" | "daily" | "weekly";
  periodKey?: string;
  queued?: boolean;
  error?: string;
};

type LedgerItem = {
  ts?: number;
  wallet?: string;
  missionId?: string;
  period?: "once" | "daily" | "weekly";
  periodKey?: string;
  amount?: number;
  reason?: string;
  raw?: string;
};

type HistoryResponse = {
  ok: boolean;
  wallet: string;
  items: LedgerItem[];
  error?: string;
};

function pickNumber(...vals: any[]) {
  for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

// ----- period helpers (UTC) -----
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayKeyUTC(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function isoWeekKeyUTC(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNo)}`;
}
function parseMissionPeriod(id: string): "daily" | "weekly" | "once" {
  const s = (id || "").trim();
  const idx = s.indexOf(":");
  if (idx > 0) {
    const p = s.slice(0, idx).toLowerCase();
    if (p === "daily" || p === "weekly" || p === "once") return p as any;
  }
  return "once";
}

export function MissionProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, connected, connecting, disconnect } = useWallet();
  const { setVisible } = useWalletModal();

  const walletAddress = useMemo(
    () => (publicKey ? publicKey.toBase58() : null),
    [publicKey]
  );

  // ✅ stats：来自后端
  const [statsByWallet, setStatsByWallet] = useState<
    Record<string, { points: number; completed: number }>
  >({});

  // ✅ 已领状态：来自 ledger(history)
  const [claimsByWallet, setClaimsByWallet] = useState<
    Record<
      string,
      {
        todayKey: string;
        weekKey: string;
        daily: string[];
        weekly: string[];
        once: string[];
      }
    >
  >({});

  // ✅ 本地 pending（用于：提交后立刻显示“等待审核”，无需等 refresh/history）
  const [pendingByWallet, setPendingByWallet] = useState<Record<string, string[]>>({});

  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});

  const points = useMemo(() => {
    if (!walletAddress) return 0;
    return statsByWallet[walletAddress]?.points ?? 0;
  }, [statsByWallet, walletAddress]);

  const completedCount = useMemo(() => {
    if (!walletAddress) return 0;
    return statsByWallet[walletAddress]?.completed ?? 0;
  }, [statsByWallet, walletAddress]);

  const claims = useMemo(() => {
    if (!walletAddress) return null;
    return claimsByWallet[walletAddress] ?? null;
  }, [claimsByWallet, walletAddress]);

  const pendingIds = useMemo(() => {
    if (!walletAddress) return [];
    return pendingByWallet[walletAddress] ?? [];
  }, [pendingByWallet, walletAddress]);

  // ✅ “是否走人工审核”的规则（你可以按自己任务体系微调）
  // 推荐：非 onchain 的任务都走 submit + admin approve
  function shouldUseAdminReview(m: Mission) {
    const isOnchain = Boolean((m as any).onchain);
    return !isOnchain; // ✅ 非链上任务走人工审核
  }

  const missions = useMemo(() => {
    const today = todayKeyUTC();
    const week = isoWeekKeyUTC();

    return baseMissions.map((m) => {
      if (m.status === "locked") return m;

      const period = parseMissionPeriod(m.id);

      // ✅ pending 优先：提交后立刻显示等待审核
      const isPending = walletAddress ? pendingIds.includes(m.id) : false;
      if (isPending) return { ...m, status: "cooldown" as const };

      const isVerifying = walletAddress ? verifyingId === m.id : false;
      if (isVerifying) return { ...m, status: "cooldown" as const };

      if (!walletAddress) return { ...m, status: "available" as const };

      if (!claims) return { ...m, status: "available" as const };

      const claimsToday = claims.todayKey === today ? claims.daily : [];
      const claimsWeek = claims.weekKey === week ? claims.weekly : [];

      let isClaimed = false;

      if (period === "daily") isClaimed = claimsToday.includes(m.id);
      else if (period === "weekly") isClaimed = claimsWeek.includes(m.id);
      else isClaimed = claims.once.includes(m.id) || claimsToday.includes(m.id) || claimsWeek.includes(m.id);

      if (isClaimed) return { ...m, status: "completed" as const };
      return { ...m, status: "available" as const };
    });
  }, [claims, verifyingId, walletAddress, pendingIds]);

  const connectWallet = async () => setVisible(true);

  const disconnectWallet = async () => {
    await disconnect();
    setErrors({});
    setVerifyingId(null);
  };

  const setStatsForWallet = (wallet: string, p: number, c: number) => {
    setStatsByWallet((prev) => ({
      ...prev,
      [wallet]: { points: p, completed: c },
    }));
  };

  const setClaimsForWalletFromLedger = (wallet: string, items: LedgerItem[]) => {
    const today = todayKeyUTC();
    const week = isoWeekKeyUTC();

    const daily: string[] = [];
    const weekly: string[] = [];
    const once: string[] = [];

    for (const it of items || []) {
      const mid = String(it?.missionId || "").trim();
      if (!mid) continue;

      const period = (it.period as any) || parseMissionPeriod(mid);

      if (period === "daily") {
        if (it.periodKey === today) daily.push(mid);
      } else if (period === "weekly") {
        if (it.periodKey === week) weekly.push(mid);
      } else {
        once.push(mid);
      }
    }

    const uniq = (arr: string[]) => Array.from(new Set(arr));

    setClaimsByWallet((prev) => ({
      ...prev,
      [wallet]: {
        todayKey: today,
        weekKey: week,
        daily: uniq(daily),
        weekly: uniq(weekly),
        once: uniq(once),
      },
    }));
  };

  // ✅ 如果 ledger 已经出现了该任务，就把本地 pending 清掉
  const clearPendingIfClaimed = (wallet: string) => {
    const c = claimsByWallet[wallet];
    if (!c) return;

    const today = todayKeyUTC();
    const week = isoWeekKeyUTC();

    const claimed = new Set<string>();
    if (c.todayKey === today) c.daily.forEach((x) => claimed.add(x));
    if (c.weekKey === week) c.weekly.forEach((x) => claimed.add(x));
    c.once.forEach((x) => claimed.add(x));

    setPendingByWallet((prev) => {
      const cur = prev[wallet] ?? [];
      const next = cur.filter((id) => !claimed.has(id));
      return { ...prev, [wallet]: next };
    });
  };

  /** ✅ 拉 stats + history */
  const refreshAll = async (wallet: string) => {
    if (!wallet) return;

    // 1) stats
    const r1 = await fetch(`/api/mission/stats?wallet=${encodeURIComponent(wallet)}`, {
      method: "GET",
      cache: "no-store",
    });

    const s = (await r1.json().catch(() => ({}))) as StatsResponse;
    if (r1.ok && s?.ok) {
      const nextPoints = pickNumber(s.totalPoints, s.points, s.points_total);
      const nextCompleted = pickNumber(s.completed, s.completedCount, s.completed_total);
      setStatsForWallet(wallet, nextPoints, nextCompleted);
    }

    // 2) history
    const r2 = await fetch(
      `/api/mission/history?wallet=${encodeURIComponent(wallet)}&limit=1000`,
      { method: "GET", cache: "no-store" }
    );
    const h = (await r2.json().catch(() => ({}))) as HistoryResponse;
    if (r2.ok && h?.ok && Array.isArray(h.items)) {
      setClaimsForWalletFromLedger(wallet, h.items);
      // ✅ 让 pending 能自动消失
      setTimeout(() => clearPendingIfClaimed(wallet), 0);
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!walletAddress) return;
      try {
        await refreshAll(walletAddress);
        if (cancelled) return;
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // ✅ 自动记分（旧 verify）
  async function postVerifyToServer(wallet: string, mission: Mission) {
    const r = await fetch("/api/mission/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        walletAddress: wallet,
        wallet,
        missionId: mission.id,
        points: mission.basePoints,
      }),
    });

    const j = (await r.json().catch(() => ({}))) as VerifyResponse;
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Server verify failed.");
    return j;
  }

  // ✅ 新增：提交审核（proof 入队）
  async function postSubmitToServer(wallet: string, mission: Mission, proof?: ProofPayload) {
    const r = await fetch("/api/mission/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        wallet,
        missionId: mission.id,
        // 你 submit 接口如果需要 periodKey，这里也可以一起传
        proof: {
          text: String(proof?.text || "").trim(),
          url: String(proof?.url || "").trim(),
        },
      }),
    });

    const j = (await r.json().catch(() => ({}))) as SubmitResponse;
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Submit failed.");
    return j;
  }

  const verify = (id: string, proof?: ProofPayload) => {
    (async () => {
      const m = baseMissions.find((x) => x.id === id);
      if (!m) return;

      setErrors((prev) => ({ ...prev, [id]: undefined }));

      if (m.status === "locked") return;
      if (verifyingId === id) return;

      if (!walletAddress) {
        setErrors((prev) => ({ ...prev, [id]: "Connect wallet first." }));
        setVisible(true);
        return;
      }

      // ✅ 已领直接返回
      const period = parseMissionPeriod(id);
      const today = todayKeyUTC();
      const week = isoWeekKeyUTC();
      const c = claimsByWallet[walletAddress];

      if (c) {
        const dailySet = c.todayKey === today ? new Set(c.daily) : new Set<string>();
        const weeklySet = c.weekKey === week ? new Set(c.weekly) : new Set<string>();
        const onceSet = new Set(c.once);

        const already =
          period === "daily"
            ? dailySet.has(id)
            : period === "weekly"
            ? weeklySet.has(id)
            : onceSet.has(id);

        if (already) return;
      }

      const isOnchain = Boolean((m as any).onchain);
      setVerifyingId(id);

      try {
        // 1) onchain 先校验
        if (isOnchain) {
          const res = await verifyOnchainMission(m, walletAddress);
          if (!res.ok) {
            setErrors((prev) => ({
              ...prev,
              [id]: res.reason ?? "Verification failed.",
            }));
            return;
          }
        }

        // 2) 决定走审核还是直接记分
        if (shouldUseAdminReview(m)) {
          await postSubmitToServer(walletAddress, m, proof);

          // ✅ 立刻 pending（不用等刷新）
          setPendingByWallet((prev) => {
            const cur = prev[walletAddress] ?? [];
            if (cur.includes(id)) return prev;
            return { ...prev, [walletAddress]: [id, ...cur] };
          });

          // ✅ 给用户即时反馈（MissionCard 会把它显示成“Submitted”样式）
          setErrors((prev) => ({
            ...prev,
            [id]: "Submitted. Waiting for admin approval.",
          }));

          // 可选：刷新一下（但即使不刷新，pending 也会显示）
          await refreshAll(walletAddress);
          return;
        }

        // 3) 直接记分（保留能力）
        const j = await postVerifyToServer(walletAddress, m);

        const nextPoints = pickNumber(j.totalPoints, j.points);
        const nextCompleted = pickNumber(j.completed, j.completedCount);
        if (nextPoints || nextCompleted) {
          setStatsForWallet(walletAddress, nextPoints, nextCompleted);
        }

        await refreshAll(walletAddress);
      } catch (e: any) {
        setErrors((prev) => ({
          ...prev,
          [id]: e?.message ?? "Verification error.",
        }));
      } finally {
        setVerifyingId(null);
      }
    })();
  };

  const reset = () => {
    if (!walletAddress) return;
    setClaimsByWallet((prev) => {
      const next = { ...prev };
      delete next[walletAddress];
      return next;
    });
    setStatsByWallet((prev) => {
      const next = { ...prev };
      delete next[walletAddress];
      return next;
    });
    setPendingByWallet((prev) => {
      const next = { ...prev };
      delete next[walletAddress];
      return next;
    });
    setErrors({});
    setVerifyingId(null);
  };

  const resetAll = () => {
    setClaimsByWallet({});
    setStatsByWallet({});
    setPendingByWallet({});
    setErrors({});
    setVerifyingId(null);
  };

  const value: MissionState = {
    missions,
    points,
    completedCount,

    walletAddress,
    connecting,
    connected,
    connectWallet,
    disconnectWallet,

    verifyingId,
    errors,
    verify,
    reset,
    resetAll,
  };

  return (
    <MissionContext.Provider value={value}>{children}</MissionContext.Provider>
  );
}

export function useMission() {
  const ctx = useContext(MissionContext);
  if (!ctx) throw new Error("useMission must be used within MissionProvider");
  return ctx;
}
