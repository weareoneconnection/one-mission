"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import MissionCard from "../components/MissionCard";
import MissionFilters from "../components/MissionFilters";
import { useMission } from "@/lib/mission/store";
import type { Mission } from "@/lib/mission/types";

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-zinc-600">{hint}</div> : null}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-900/10 bg-white/70 px-3 py-1 text-xs font-medium text-zinc-700">
      {children}
    </span>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function SecondaryLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
    >
      {children}
    </Link>
  );
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export default function MissionsPage() {
  const {
    missions,
    verify,
    points,
    completedCount,

    walletAddress,
    connecting,
    connectWallet,
    disconnectWallet,
  } = useMission();

  const [category, setCategory] = useState<"all" | Mission["category"]>("all");
  const [status, setStatus] = useState<"all" | Mission["status"]>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"default" | "points_desc" | "points_asc">(
    "default"
  );

  // ✅ extra stats from upgraded /api/mission/stats (optional fields)
  const [extra, setExtra] = useState<{
    uniqueCompleted?: number;
    streak?: { count?: number; lastDate?: string; active?: boolean };
    updatedAt?: number;
  } | null>(null);

  const refreshExtraStats = async (w?: string | null) => {
    const addr = (w || walletAddress || "").trim();
    if (!addr) return;

    try {
      const r = await fetch(`/api/mission/stats?wallet=${addr}`, {
        method: "GET",
        cache: "no-store",
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) {
        setExtra({
          uniqueCompleted: typeof j.uniqueCompleted === "number" ? j.uniqueCompleted : undefined,
          streak: j.streak || undefined,
          updatedAt: typeof j.updatedAt === "number" ? j.updatedAt : undefined,
        });
      }
    } catch {
      // ignore
    }
  };

  // ✅ refresh stats when wallet changes
  useEffect(() => {
    if (!walletAddress) {
      setExtra(null);
      return;
    }
    refreshExtraStats(walletAddress);
    // optional: poll every 30s (safe)
    const t = setInterval(() => refreshExtraStats(walletAddress), 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = missions.filter((m) => {
      if (category !== "all" && m.category !== category) return false;
      if (status !== "all" && m.status !== status) return false;
      if (q) {
        const hay = `${m.title} ${m.description ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sort === "points_desc")
      list = [...list].sort((a, b) => b.basePoints - a.basePoints);
    if (sort === "points_asc")
      list = [...list].sort((a, b) => a.basePoints - b.basePoints);

    return list;
  }, [missions, category, status, query, sort]);

  const shortWallet = useMemo(() => {
    if (!walletAddress) return "";
    return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
  }, [walletAddress]);

  const progressText = `${completedCount}/${missions.length}`;

  const streakCount = extra?.streak?.count ?? 0;
  const streakActive = Boolean(extra?.streak?.active);
  const uniqueCompleted = extra?.uniqueCompleted ?? 0;

  return (
    <div className="space-y-6">
      {/* =================== TOP DASHBOARD =================== */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
          {/* Left: identity + intro */}
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>ONE MISSION</Badge>
              <Badge>Long-term Points</Badge>
              <Badge>Daily / Weekly / Once</Badge>
              <Badge>Wallet Reputation</Badge>
            </div>

            <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">
              Your mission workspace (continuous points)
            </h2>

            <p className="text-sm text-zinc-700">
              Use <b>one wallet</b> to build a consistent reputation. Daily/weekly missions can be
              claimed again after reset; once missions are unique.
            </p>

            {/* Wallet row */}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-zinc-700">Wallet:</span>

              {walletAddress ? (
                <span className="rounded-full border border-zinc-900/10 bg-white px-3 py-1 font-semibold">
                  {shortWallet}
                </span>
              ) : (
                <span className="text-zinc-500">Not connected</span>
              )}

              <div className="ml-1 flex items-center gap-2">
                {!walletAddress ? (
                  <PrimaryButton onClick={connectWallet} disabled={connecting}>
                    {connecting ? "Connecting..." : "Connect Wallet"}
                  </PrimaryButton>
                ) : (
                  <button
                    type="button"
                    onClick={disconnectWallet}
                    className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm hover:bg-white"
                  >
                    Disconnect
                  </button>
                )}

                {/* manual refresh (nice) */}
                <button
                  type="button"
                  onClick={() => refreshExtraStats(walletAddress)}
                  disabled={!walletAddress}
                  className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm hover:bg-white disabled:opacity-60"
                >
                  Refresh
                </button>
              </div>
            </div>

            {/* Quick actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              <SecondaryLink href="/mission/overview">Overview</SecondaryLink>
              <SecondaryLink href="/mission/rewards">Rewards</SecondaryLink>
              <SecondaryLink href="/mission/leaderboard">Leaderboard</SecondaryLink>
              <SecondaryLink href="/mission/history">History</SecondaryLink>
            </div>

            {/* Reset hint */}
            <div className="text-xs text-zinc-600 pt-1">
              Reset reference: <b>Daily missions reset at 00:00 UTC</b>. Weekly missions reset by ISO week.
            </div>
          </div>

          {/* Right: stats grid */}
          <div className="grid grid-cols-2 gap-3 md:w-[420px]">
            <StatCard label="Total Points" value={fmt(points)} hint="All-time points" />
            <StatCard label="Total Claims" value={progressText} hint="Claims (daily+weekly+once)" />
            <StatCard
              label="Unique Completed"
              value={walletAddress ? fmt(uniqueCompleted) : "—"}
              hint="Once missions only"
            />
            <StatCard
              label="Daily Streak"
              value={walletAddress ? `${streakCount}${streakActive ? " 🔥" : ""}` : "—"}
              hint={streakActive ? "Active today" : "Do a daily mission to keep streak"}
            />
          </div>
        </div>
      </div>

      {/* Wallet required提示 */}
      {!walletAddress && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-50/60 p-4 text-sm text-amber-900 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="font-semibold">Wallet required for verification</div>
            <div className="text-amber-900/80">
              Connect your Solana wallet to verify on-chain missions and lock in your long-term points.
            </div>
          </div>
          <PrimaryButton onClick={connectWallet} disabled={connecting}>
            {connecting ? "Connecting..." : "Connect Wallet"}
          </PrimaryButton>
        </div>
      )}

      {/* =================== FILTERS (sticky) =================== */}
      <div className="sticky top-0 z-10 bg-background pt-2 pb-3">
        <MissionFilters
          category={category}
          setCategory={setCategory}
          status={status}
          setStatus={setStatus}
          query={query}
          setQuery={setQuery}
          sort={sort}
          setSort={setSort}
          total={missions.length}
          shown={filtered.length}
        />
      </div>

      {/* =================== LIST =================== */}
      <div className="grid gap-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-8 text-center">
            <div className="text-base font-semibold">No missions found</div>
            <div className="mt-2 text-sm text-zinc-600">
              Try changing filters or clearing search.
            </div>
          </div>
        ) : (
          filtered.map((m) => (
            <MissionCard
              key={m.id}
              mission={m}
              onVerify={async () => {
                if (!walletAddress) {
                  await connectWallet();
                  return;
                }
                // ✅ verify keeps your onchain + server flow (store.tsx)
                verify(m.id);
                // ✅ optional: small delayed refresh to reflect streak/unique instantly
                setTimeout(() => refreshExtraStats(walletAddress), 800);
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

