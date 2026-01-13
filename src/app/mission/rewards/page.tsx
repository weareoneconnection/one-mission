"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useMission } from "@/lib/mission/store";

type RewardTier = {
  id: "og" | "early" | "genesis";
  title: string;
  requiredPoints: number;
  desc: string;
  badge?: string;
};

const TIERS: RewardTier[] = [
  {
    id: "og",
    title: "Contributor (OG Role)",
    requiredPoints: 1500,
    desc: "Foundational identity for early & verified contributors (manual verification).",
    badge: "Starter",
  },
  {
    id: "early",
    title: "Core Contributor (Early Access)",
    requiredPoints: 3500,
    desc: "Priority access to missions / drops / product access (manual verification).",
    badge: "Priority",
  },
  {
    id: "genesis",
    title: "Genesis Eligible (NFT)",
    requiredPoints: 7000,
    desc: "Genesis eligibility & historical identity anchor (manual verification).",
    badge: "Top",
  },
];

// ✅ 人工发放：提交入口（你可改成自己的官方渠道）
const OFFICIAL_SUBMIT_TEXT = "Submit Claim Info via official community channel only.";
const OFFICIAL_SUBMIT_HINT =
  "Admins will verify points & completed missions, then distribute manually. No private keys ever.";
const OFFICIAL_SUBMIT_CTA_LABEL = "Go to Official Channel";
const OFFICIAL_SUBMIT_CTA_HREF = "/mission/overview";

function mask(addr: string) {
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function fmtNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
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

function Pill({
  active,
  children,
}: {
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-3 py-1 text-xs border",
        active
          ? "bg-black text-white border-black"
          : "bg-white/60 border-zinc-900/15",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

async function copyText(text: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

export default function RewardsPage() {
  const {
    walletAddress,
    connecting,
    connectWallet,
    points,
    completedCount,
  } = useMission() as any;

  const [toast, setToast] = useState<string>("");

  const totalPoints = Number(points ?? 0);
  const completed = Number(completedCount ?? 0);

  const topUnlocked = useMemo(() => {
    const eligible = TIERS.filter((t) => totalPoints >= t.requiredPoints);
    if (!eligible.length) return null;
    return eligible.sort((a, b) => b.requiredPoints - a.requiredPoints)[0];
  }, [totalPoints]);

  const nextTier = useMemo(() => {
    const locked = TIERS.filter((t) => totalPoints < t.requiredPoints).sort(
      (a, b) => a.requiredPoints - b.requiredPoints
    );
    return locked[0] ?? null;
  }, [totalPoints]);

  const headerSub = walletAddress
    ? `Wallet connected: ${mask(walletAddress)}`
    : "Connect wallet to view eligibility status.";

  const claimInfoBase = useMemo(() => {
    const now = new Date().toISOString();
    const nonce = Math.random().toString(36).slice(2, 10).toUpperCase();
    return { now, nonce };
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-zinc-600">
              IDENTITY & REWARDS
            </div>
            <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">
              Unlock eligibility through verified contribution
            </h2>
            <p className="text-sm text-zinc-700">
              {headerSub} Eligibility may be <b>manually verified</b> before
              distribution.
            </p>

            {!walletAddress ? (
              <div className="pt-2">
                <button
                  type="button"
                  onClick={connectWallet}
                  disabled={connecting}
                  className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
                >
                  {connecting ? "Connecting..." : "Connect Wallet"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 md:w-[420px]">
            <StatCard
              label="Total Points"
              value={fmtNumber(totalPoints)}
              sub="All-time contribution index"
            />
            <StatCard
              label="Verified Missions"
              value={completed}
              sub="Completed & verified"
            />
            <StatCard
              label="Highest Eligible"
              value={topUnlocked ? topUnlocked.title : "—"}
              sub={
                topUnlocked
                  ? `≥ ${fmtNumber(topUnlocked.requiredPoints)} pts`
                  : "Not eligible yet"
              }
            />
            <StatCard
              label="Next Target"
              value={nextTier ? nextTier.title : "All tiers reached"}
              sub={
                nextTier
                  ? `Need ${fmtNumber(
                      Math.max(0, nextTier.requiredPoints - totalPoints)
                    )} pts`
                  : "You reached the top tier"
              }
            />
          </div>
        </div>
      </div>

      {/* Submit instructions */}
      <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-zinc-900">
              {OFFICIAL_SUBMIT_TEXT}
            </div>
            <div className="text-xs text-zinc-600">{OFFICIAL_SUBMIT_HINT}</div>
          </div>
          <Link
            href={OFFICIAL_SUBMIT_CTA_HREF}
            className="inline-flex items-center justify-center rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm font-medium hover:bg-white"
          >
            {OFFICIAL_SUBMIT_CTA_LABEL}
          </Link>
        </div>
      </div>

      {/* Toast */}
      {toast ? (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-50/60 p-4 text-sm text-emerald-900">
          {toast}
        </div>
      ) : null}

      {/* Tiers */}
      <div className="grid gap-4 md:grid-cols-2">
        {TIERS.map((t) => {
          const hasWallet = Boolean(walletAddress);
          const eligible = hasWallet && totalPoints >= t.requiredPoints;
          const need = Math.max(0, t.requiredPoints - totalPoints);

          const statusPill = !hasWallet ? (
            <Pill>Connect wallet</Pill>
          ) : eligible ? (
            <Pill active>Eligible</Pill>
          ) : (
            <Pill>Not eligible</Pill>
          );

          const claimInfo = [
            `Campaign: WAOC One Mission`,
            `Identity/Reward: ${t.title}`,
            `Wallet: ${walletAddress ?? "NOT_CONNECTED"}`,
            `Points (all-time): ${totalPoints}`,
            `Verified missions: ${completed}`,
            `Timestamp: ${claimInfoBase.now}`,
            `Nonce: ${claimInfoBase.nonce}-${t.id.toUpperCase()}`,
          ].join("\n");

          const progressPct =
            t.requiredPoints > 0
              ? Math.min(100, (totalPoints / t.requiredPoints) * 100)
              : 0;

          return (
            <div
              key={t.id}
              className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-zinc-900">
                    {t.title}
                  </div>
                  <div className="text-sm text-zinc-700">
                    Required: <b>{fmtNumber(t.requiredPoints)} pts</b>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {t.badge ? <Pill>{t.badge}</Pill> : null}
                  {statusPill}
                </div>
              </div>

              <div className="mt-3 text-sm text-zinc-700">{t.desc}</div>

              {/* Progress */}
              <div className="mt-4 rounded-2xl border border-zinc-900/10 bg-white/60 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-700">Your points</span>
                  <span className="font-semibold text-zinc-900">
                    {fmtNumber(totalPoints)}
                  </span>
                </div>

                <div className="mt-2 h-2 w-full rounded-full bg-zinc-900/10">
                  <div
                    className="h-2 rounded-full bg-zinc-900"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>

                <div className="mt-2 text-xs text-zinc-600">
                  {!hasWallet
                    ? "Connect wallet to compute eligibility."
                    : eligible
                    ? "Eligible — copy claim info and submit to admins."
                    : `Need ${fmtNumber(need)} pts to reach eligibility.`}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-wrap gap-3">
                {!hasWallet ? (
                  <button
                    type="button"
                    onClick={connectWallet}
                    disabled={connecting}
                    className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
                  >
                    {connecting ? "Connecting..." : "Connect Wallet"}
                  </button>
                ) : eligible ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await copyText(claimInfo);
                      setToast(`Copied Claim Info for: ${t.title}`);
                      window.setTimeout(() => setToast(""), 2000);
                    }}
                    className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm font-semibold hover:bg-white"
                  >
                    Copy Claim Info
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="rounded-xl border border-zinc-900/10 bg-white/40 px-4 py-2 text-sm font-semibold text-zinc-400"
                  >
                    Not eligible yet
                  </button>
                )}

                <Link
                  href="/mission/missions"
                  className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm font-medium hover:bg-white"
                >
                  Go earn points →
                </Link>
              </div>

              {/* Manual claim note */}
              <div className="mt-4 text-xs text-zinc-600">
                Manual distribution: admins will verify on-chain / wallet-based
                proof. <b>No private keys</b> required.
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer safety */}
      <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-5 text-sm text-zinc-700">
        <div className="font-semibold text-zinc-900">Safety</div>
        <div className="mt-2">
          WAOC will <b>never</b> ask for seed phrases or private keys. Verify
          only via official links inside this site.
        </div>
      </div>
    </div>
  );
}
