"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { useMission } from "@/lib/mission/store";
import type { Mission } from "@/lib/mission/types";

function mask(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-4">
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="mt-1 text-xl font-semibold text-zinc-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-600">{sub}</div> : null}
    </div>
  );
}

function BigPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
      <div className="text-xs font-medium tracking-wide text-zinc-600">
        {title}
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

export default function ProfilePage() {
  const {
    walletAddress,
    connecting,
    connectWallet,
    disconnectWallet,
    points,
    completedCount,
    missions,
  } = useMission();

  const completedMissions = useMemo(() => {
    const list = (missions ?? []) as Mission[];
    // 兼容：有些项目用 status=completed，有些用 completed=true
    return list.filter((m: any) => m?.status === "completed" || m?.completed === true);
  }, [missions]);

  const rankText = useMemo(() => {
    // 现在 Profile 先显示占位，等你接 KV/Redis leaderboard 后再从 /api/leaderboard?wallet=xxx 拉 rank
    return walletAddress ? "—" : "—";
  }, [walletAddress]);

  const badges = useMemo(() => {
    const pts = points ?? 0;
    const out: string[] = [];
    if (pts >= 500) out.push("OG");
    if (pts >= 1000) out.push("Early Access");
    if (pts >= 2000) out.push("Genesis Eligible");
    return out;
  }, [points]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-zinc-600">
              PROFILE
            </div>
            <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">
              Your identity, reputation & progress
            </h2>
            <p className="text-sm text-zinc-700">
              Wallet-based profile. Complete missions to increase points and unlock rewards.
            </p>

            <div className="pt-2 flex flex-wrap items-center gap-2">
              {!walletAddress ? (
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={connecting}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
                >
                  {connecting ? "Connecting..." : "Connect Wallet"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={disconnectWallet}
                  className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm hover:bg-white"
                >
                  Disconnect
                </button>
              )}

              <Link
                href="/mission/missions"
                className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm hover:bg-white"
              >
                Go to Missions
              </Link>

              <Link
                href="/mission/rewards"
                className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm hover:bg-white"
              >
                View Rewards
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 md:w-[420px]">
            <StatCard
              label="Current Wallet"
              value={walletAddress ? mask(walletAddress) : "Not connected"}
              sub="Used for verification"
            />
            <StatCard label="Completed" value={completedCount} sub="Verified missions" />
            <StatCard label="Points" value={walletAddress ? points : "—"} sub="Earned so far" />
            <StatCard label="Rank" value={walletAddress ? rankText : "—"} sub="Leaderboard rank" />
          </div>
        </div>
      </div>

      {/* Progress panel */}
      <BigPanel title="PROGRESS">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="text-sm text-zinc-700">
              <span className="font-semibold">Completed Missions:</span>{" "}
              {completedCount}/{missions.length}
            </div>
            <div className="text-sm text-zinc-700">
              <span className="font-semibold">Badges:</span>{" "}
              {badges.length ? (
                <span className="inline-flex flex-wrap gap-2 ml-2">
                  {badges.map((b) => (
                    <span
                      key={b}
                      className="inline-flex items-center rounded-full border border-zinc-900/15 bg-white px-3 py-1 text-xs font-medium"
                    >
                      {b}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-zinc-500">None yet</span>
              )}
            </div>

            <div className="text-xs text-zinc-600 pt-1">
              Tip: Connect one consistent wallet to build reputation (anti-spam).
            </div>
          </div>

          {/* simple progress bar */}
          <div className="w-full md:w-[420px]">
            <div className="text-xs text-zinc-600 mb-2">Overall completion</div>
            <div className="h-3 w-full rounded-full bg-zinc-900/10 overflow-hidden">
              <div
                className="h-full bg-black"
                style={{
                  width: `${
                    missions.length ? Math.round((completedCount / missions.length) * 100) : 0
                  }%`,
                }}
              />
            </div>
            <div className="mt-2 text-xs text-zinc-600">
              {missions.length
                ? `${Math.round((completedCount / missions.length) * 100)}%`
                : "0%"}
            </div>
          </div>
        </div>
      </BigPanel>

      {/* Recent missions */}
      <BigPanel title="RECENT MISSIONS">
        {walletAddress ? (
          completedMissions.length ? (
            <div className="space-y-2">
              {completedMissions.slice(0, 8).map((m: any) => (
                <div
                  key={m.id}
                  className="rounded-2xl border border-zinc-900/10 bg-white/60 p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-900 truncate">{m.title}</div>
                    <div className="mt-0.5 text-xs text-zinc-600 truncate">
                      {m.category ? `Category: ${m.category}` : "Verified mission"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold text-zinc-900">
                      +{m.basePoints ?? m.points ?? 0} pts
                    </div>
                    <div className="text-xs text-zinc-600">Completed</div>
                  </div>
                </div>
              ))}

              <div className="pt-2">
                <Link
                  href="/mission/missions"
                  className="inline-flex items-center justify-center rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm hover:bg-white"
                >
                  View all missions →
                </Link>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-900/10 bg-white/60 p-6">
              <div className="font-semibold text-zinc-900">No completed missions yet</div>
              <div className="mt-2 text-sm text-zinc-700">
                Start from the Missions page and verify tasks to earn points.
              </div>
              <div className="mt-4">
                <Link
                  href="/mission/missions"
                  className="inline-flex items-center justify-center rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90"
                >
                  Start Missions
                </Link>
              </div>
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-zinc-900/10 bg-white/60 p-6">
            <div className="font-semibold text-zinc-900">Connect wallet to view your profile</div>
            <div className="mt-2 text-sm text-zinc-700">
              Your progress and claim eligibility are tied to your wallet.
            </div>
            <div className="mt-4">
              <button
                type="button"
                onClick={connectWallet}
                disabled={connecting}
                className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
              >
                {connecting ? "Connecting..." : "Connect Wallet"}
              </button>
            </div>
          </div>
        )}
      </BigPanel>
    </div>
  );
}
