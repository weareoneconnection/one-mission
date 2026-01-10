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

  verify: (id: string) => void;
  reset: () => void;
  resetAll: () => void;
};

const MissionContext = createContext<MissionState | null>(null);

// ✅ 任务定义（不写 completed）
// status: completed -> available（由“本周期是否已领”决定）
const baseMissions: Mission[] = mockMissions.map((m) => ({
  ...m,
  status: m.status === "completed" ? "available" : m.status,
}));

/** -----------------------------
 *  Response Types (兼容字段)
 * ------------------------------ */
type StatsResponse = {
  ok: boolean;
  wallet: string;

  // legacy compatibility
  points?: number;
  totalPoints?: number;
  completed?: number;
  completedCount?: number;

  // new shape compatibility (如果你后端已经升级成更丰富结构，也能吃)
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

  // ✅ 权威 stats：来自后端
  const [statsByWallet, setStatsByWallet] = useState<
    Record<string, { points: number; completed: number }>
  >({});

  // ✅ 本周期“已领”状态：来自 ledger(history) 推导
  const [claimsByWallet, setClaimsByWallet] = useState<
    Record<
      string,
      {
        todayKey: string;
        weekKey: string;
        daily: string[];  // missionId list claimed today
        weekly: string[]; // missionId list claimed this week
        once: string[];   // missionId list claimed ever (once missions)
      }
    >
  >({});

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

  const missions = useMemo(() => {
    const today = todayKeyUTC();
    const week = isoWeekKeyUTC();

    return baseMissions.map((m) => {
      if (m.status === "locked") return m;

      const period = parseMissionPeriod(m.id);

      const isVerifying = walletAddress ? verifyingId === m.id : false;
      if (isVerifying) return { ...m, status: "cooldown" as const };

      if (!walletAddress) return { ...m, status: "available" as const };

      // If we haven't loaded claims yet, keep available (no flicker to completed)
      if (!claims) return { ...m, status: "available" as const };

      // If date/week rolled, treat as empty until refreshed
      const claimsToday = claims.todayKey === today ? claims.daily : [];
      const claimsWeek = claims.weekKey === week ? claims.weekly : [];

      let isClaimed = false;

      if (period === "daily") isClaimed = claimsToday.includes(m.id);
      else if (period === "weekly") isClaimed = claimsWeek.includes(m.id);
      else isClaimed = claims.once.includes(m.id) || claimsToday.includes(m.id) || claimsWeek.includes(m.id);

      if (isClaimed) return { ...m, status: "completed" as const };
      return { ...m, status: "available" as const };
    });
  }, [claims, verifyingId, walletAddress]);

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
        // once
        once.push(mid);
      }
    }

    // de-dup
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

  /** ✅ 拉 stats + history（一次拉齐，避免状态不一致） */
  const refreshAll = async (wallet: string) => {
    if (!wallet) return;

    // 1) stats
    const r1 = await fetch(`/api/mission/stats?wallet=${encodeURIComponent(wallet)}`, {
      method: "GET",
      cache: "no-store",
    });

    const s = (await r1.json().catch(() => ({}))) as StatsResponse;
    if (r1.ok && s?.ok) {
      const nextPoints = pickNumber(
        s.totalPoints,
        s.points,
        s.points_total
      );
      const nextCompleted = pickNumber(
        s.completed,
        s.completedCount,
        s.completed_total
      );
      setStatsForWallet(wallet, nextPoints, nextCompleted);
    }

    // 2) history / ledger -> determine per-period claimed status
    const r2 = await fetch(
      `/api/mission/history?wallet=${encodeURIComponent(wallet)}&limit=200`,
      { method: "GET", cache: "no-store" }
    );
    const h = (await r2.json().catch(() => ({}))) as HistoryResponse;
    if (r2.ok && h?.ok && Array.isArray(h.items)) {
      setClaimsForWalletFromLedger(wallet, h.items);
    }
  };

  // ✅ wallet 变化自动刷新
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!walletAddress) return;
      try {
        await refreshAll(walletAddress);
        if (cancelled) return;
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // ✅ 写后端（长期周期版）
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

  const verify = (id: string) => {
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

      // ✅ “是否已领”以 ledger 推导为准（daily/weekly 只在本周期有效）
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
        // 1) onchain 任务先校验
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

        // 2) 写入后端积分（支持 daily/weekly/once）
        const j = await postVerifyToServer(walletAddress, m);

        // 3) 局部更新 stats（可选），最终以 refreshAll 为准
        const nextPoints = pickNumber(j.totalPoints, j.points);
        const nextCompleted = pickNumber(j.completed, j.completedCount);
        if (nextPoints || nextCompleted) {
          setStatsForWallet(walletAddress, nextPoints, nextCompleted);
        }

        // 4) 强制刷新（拿到最新 ledger -> 更新“本周期已领”）
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

  // ✅ 本地 reset（不影响后端）
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
    setErrors({});
    setVerifyingId(null);
  };

  const resetAll = () => {
    setClaimsByWallet({});
    setStatsByWallet({});
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
