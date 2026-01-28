"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMission } from "@/lib/mission/store";

type RewardTier = {
  id: "og" | "contributor" | "guardian";
  title: string;
  requiredPoints: number;
  requiredVerified?: number; // completed_total
  requiredOnce?: number; // unique_once_total
  desc: string;
  badge?: string;
  roleName: "OG" | "Contributor" | "Guardian";
};

type RoleApi = {
  ok?: boolean;
  wallet?: string;
  roles?: string[];
  level?: number;
  offchain?: {
    points_total?: number;
    completed_total?: number;
    unique_once_total?: number;
  };
  thresholds?: {
    OG_POINTS?: number;
    CONTRIBUTOR_POINTS?: number;
    GUARDIAN_POINTS?: number;
    OG_UNIQUE_ONCE?: number;
    CONTRIBUTOR_COMPLETED?: number;
    GUARDIAN_COMPLETED?: number;
  };
  reasons?: Record<string, any>;
  error?: string;
};

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

function Pill({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={[
        "inline-flex items-center rounded-full px-3 py-1 text-xs border",
        active ? "bg-black text-white border-black" : "bg-white/60 border-zinc-900/15",
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

// ✅ 人工发放：提交入口（你可改成自己的官方渠道）
const OFFICIAL_SUBMIT_TEXT = "Submit Claim Info via official community channel only.";
const OFFICIAL_SUBMIT_HINT =
  "Admins will verify points & completed missions, then distribute manually. No private keys ever.";
const OFFICIAL_SUBMIT_CTA_LABEL = "Go to Official Channel";
const OFFICIAL_SUBMIT_CTA_HREF = "/mission/overview";

function getTierDesc(role: RewardTier["roleName"]) {
  if (role === "OG")
    return "Entry tier for early contributors. Unlocks OG identity + eligibility for starter rewards (manual verification).";
  if (role === "Contributor")
    return "Main reward tier. Based on verified missions + points. Designed for most active contributors (manual verification).";
  return "Top-tier identity. Priority access to drops/allowlist and future governance considerations (manual verification).";
}

function computeEligibleByRole(api: RoleApi | null, role: RewardTier["roleName"]) {
  // ✅ 优先使用后端 reasons（最权威）
  const r = api?.reasons?.[role];
  if (r && typeof r === "object") {
    if (typeof r.ok === "boolean") return r.ok;
  }

  // fallback：用 thresholds + offchain 自算
  const pts = Number(api?.offchain?.points_total ?? 0);
  const done = Number(api?.offchain?.completed_total ?? 0);
  const once = Number(api?.offchain?.unique_once_total ?? 0);

  const th = api?.thresholds || {};
  if (role === "OG") {
    const needPts = Number(th.OG_POINTS ?? 0);
    const needOnce = Number(th.OG_UNIQUE_ONCE ?? 0);
    return pts >= needPts && once >= needOnce;
  }
  if (role === "Contributor") {
    const needPts = Number(th.CONTRIBUTOR_POINTS ?? 0);
    const needDone = Number(th.CONTRIBUTOR_COMPLETED ?? 0);
    return pts >= needPts && done >= needDone;
  }
  const needPts = Number(th.GUARDIAN_POINTS ?? 0);
  const needDone = Number(th.GUARDIAN_COMPLETED ?? 0);
  return pts >= needPts && done >= needDone;
}

// ✅ 安全裁剪，避免 claim info 太长
function safeJson(value: any, maxLen = 1800) {
  try {
    const s = JSON.stringify(
      value,
      (_k, v) => {
        if (typeof v === "function") return undefined;
        if (typeof v === "string" && v.length > 500) return v.slice(0, 500) + "…";
        return v;
      },
      2
    );
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + "\n…(trimmed)";
  } catch {
    return "[unserializable]";
  }
}

// ✅ 抽取给管理员看的对账摘要
function buildAdminSnapshot(api: RoleApi | null) {
  return {
    wallet: api?.wallet || "",
    roles: api?.roles || [],
    level: api?.level ?? null,
    offchain: api?.offchain || {},
    thresholds: api?.thresholds || {},
    // reasons 很可能比较大，但很关键；保留
    reasons: api?.reasons || {},
  };
}

export default function RewardsPage() {
  const { walletAddress, connecting, connectWallet, points, completedCount } = useMission() as any;

  const [toast, setToast] = useState<string>("");
  const [roleApi, setRoleApi] = useState<RoleApi | null>(null);
  const [roleErr, setRoleErr] = useState<string>("");

  const storePoints = Number(points ?? 0);
  const storeCompleted = Number(completedCount ?? 0);

  const apiPoints = Number(roleApi?.offchain?.points_total ?? NaN);
  const apiCompleted = Number(roleApi?.offchain?.completed_total ?? NaN);
  const apiOnce = Number(roleApi?.offchain?.unique_once_total ?? 0);

  const totalPoints = Number.isFinite(apiPoints) ? apiPoints : storePoints;
  const completed = Number.isFinite(apiCompleted) ? apiCompleted : storeCompleted;

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setRoleErr("");
      setRoleApi(null);
      if (!walletAddress) return;

      try {
        const r = await fetch(`/api/role?wallet=${encodeURIComponent(walletAddress)}`, {
          method: "GET",
          cache: "no-store",
        });
        const j: RoleApi = await r.json().catch(() => ({} as any));
        if (!mounted) return;

        if (!r.ok || !j?.ok) {
          setRoleErr(j?.error || `Failed to load role (${r.status})`);
          setRoleApi(j || null);
          return;
        }
        setRoleApi(j);
      } catch (e: any) {
        if (!mounted) return;
        setRoleErr(e?.message || "Failed to load role");
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [walletAddress]);

  const thresholds = roleApi?.thresholds || {};
  const TIERS: RewardTier[] = useMemo(() => {
    const ogPts = Number(thresholds.OG_POINTS ?? 500);
    const ogOnceNeed = Number(thresholds.OG_UNIQUE_ONCE ?? 1);

    const cPts = Number(thresholds.CONTRIBUTOR_POINTS ?? 1000);
    const cDone = Number(thresholds.CONTRIBUTOR_COMPLETED ?? 10);

    const gPts = Number(thresholds.GUARDIAN_POINTS ?? 3000);
    const gDone = Number(thresholds.GUARDIAN_COMPLETED ?? 30);

    return [
      {
        id: "og",
        title: "OG Tier (Starter)",
        requiredPoints: ogPts,
        requiredOnce: ogOnceNeed,
        desc: getTierDesc("OG"),
        badge: "Starter",
        roleName: "OG",
      },
      {
        id: "contributor",
        title: "Contributor Tier (Eligible)",
        requiredPoints: cPts,
        requiredVerified: cDone,
        desc: getTierDesc("Contributor"),
        badge: "Eligible",
        roleName: "Contributor",
      },
      {
        id: "guardian",
        title: "Guardian Tier (Priority)",
        requiredPoints: gPts,
        requiredVerified: gDone,
        desc: getTierDesc("Guardian"),
        badge: "Priority",
        roleName: "Guardian",
      },
    ];
  }, [thresholds]);

  const topUnlocked = useMemo(() => {
    if (!walletAddress) return null;
    const eligible = TIERS.filter((t) => computeEligibleByRole(roleApi, t.roleName));
    if (!eligible.length) return null;
    return eligible.sort((a, b) => b.requiredPoints - a.requiredPoints)[0];
  }, [TIERS, roleApi, walletAddress]);

  const nextTier = useMemo(() => {
    if (!walletAddress) return TIERS[0] ?? null;
    const locked = TIERS.filter((t) => !computeEligibleByRole(roleApi, t.roleName)).sort(
      (a, b) => a.requiredPoints - b.requiredPoints
    );
    return locked[0] ?? null;
  }, [TIERS, roleApi, walletAddress]);

  const headerSub = walletAddress
    ? `Wallet connected: ${mask(walletAddress)}`
    : "Connect wallet to view eligibility status.";

  const claimInfoBase = useMemo(() => {
    const now = new Date().toISOString();
    const nonce = Math.random().toString(36).slice(2, 10).toUpperCase();
    return { now, nonce };
  }, []);

  const adminSnapshot = useMemo(() => buildAdminSnapshot(roleApi), [roleApi]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-zinc-600">IDENTITY & REWARDS</div>
            <h2 className="text-xl md:text-2xl font-semibold text-zinc-900">
              Unlock eligibility through verified contribution
            </h2>
            <p className="text-sm text-zinc-700">
              {headerSub} Eligibility may be <b>manually verified</b> before distribution.
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

            {walletAddress && roleErr ? (
              <div className="mt-3 rounded-2xl border border-amber-500/20 bg-amber-50/60 p-3 text-sm text-amber-900">
                {roleErr} (Fallback to local data.)
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3 md:w-[420px]">
            <StatCard label="Total Points" value={fmtNumber(totalPoints)} sub="All-time contribution index" />
            <StatCard label="Verified Missions" value={completed} sub="Completed & verified" />
            <StatCard
              label="Highest Eligible"
              value={topUnlocked ? topUnlocked.title : "—"}
              sub={topUnlocked ? `Meets ${topUnlocked.roleName} tier` : "Not eligible yet"}
            />
            <StatCard
              label="Next Target"
              value={nextTier ? nextTier.title : "All tiers reached"}
              sub={nextTier ? `Progress towards ${nextTier.roleName} tier` : "You reached the top tier"}
            />
          </div>
        </div>
      </div>

      {/* Submit instructions */}
      <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <div className="text-sm font-semibold text-zinc-900">{OFFICIAL_SUBMIT_TEXT}</div>
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
          const eligible = hasWallet ? computeEligibleByRole(roleApi, t.roleName) : false;

          const needPts = Math.max(0, t.requiredPoints - totalPoints);
          const needDone = t.requiredVerified ? Math.max(0, t.requiredVerified - completed) : 0;
          const needOnce = t.requiredOnce ? Math.max(0, t.requiredOnce - apiOnce) : 0;

          const statusPill = !hasWallet ? (
            <Pill>Connect wallet</Pill>
          ) : eligible ? (
            <Pill active>Eligible</Pill>
          ) : (
            <Pill>Not eligible</Pill>
          );

          const reqParts: string[] = [];
          if (t.requiredPoints) reqParts.push(`${fmtNumber(t.requiredPoints)} pts`);
          if (t.requiredVerified) reqParts.push(`${t.requiredVerified} verified`);
          if (t.requiredOnce) reqParts.push(`${t.requiredOnce} once`);

          const needText = !hasWallet
            ? "Connect wallet to compute eligibility."
            : eligible
            ? "Eligible — copy claim info and submit to admins."
            : (() => {
                const parts: string[] = [];
                if (needPts > 0) parts.push(`${fmtNumber(needPts)} pts`);
                if (t.requiredVerified && needDone > 0) parts.push(`${needDone} missions`);
                if (t.requiredOnce && needOnce > 0) parts.push(`${needOnce} once`);
                return parts.length ? `Need ${parts.join(" + ")} to reach eligibility.` : "Not eligible yet.";
              })();

          // ✅ 升级：把后端对账信息一起塞进 Claim Info（管理员复制即可核对）
          const claimInfo = [
            `Campaign: WAOC One Mission`,
            `Tier: ${t.title}`,
            `Role target: ${t.roleName}`,
            `Wallet: ${walletAddress ?? "NOT_CONNECTED"}`,
            `Points (all-time): ${totalPoints}`,
            `Verified missions: ${completed}`,
            `Unique once missions: ${apiOnce}`,
            `Eligibility (computed): ${eligible ? "YES" : "NO"}`,
            `Required: ${reqParts.join(" + ")}`,
            `Timestamp: ${claimInfoBase.now}`,
            `Nonce: ${claimInfoBase.nonce}-${t.id.toUpperCase()}`,
            ``,
            `--- Backend Snapshot (/api/role) ---`,
            safeJson(adminSnapshot),
          ].join("\n");

          const progressPct =
            t.requiredPoints > 0 ? Math.min(100, (totalPoints / t.requiredPoints) * 100) : 0;

          return (
            <div key={t.id} className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-lg font-semibold text-zinc-900">{t.title}</div>
                  <div className="text-sm text-zinc-700">
                    Required: <b>{reqParts.join(" + ")}</b>
                  </div>
                  <div className="text-sm text-zinc-700">
                    Role: <b>{t.roleName}</b>
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
                  <span className="font-semibold text-zinc-900">{fmtNumber(totalPoints)}</span>
                </div>

                <div className="mt-2 h-2 w-full rounded-full bg-zinc-900/10">
                  <div className="h-2 rounded-full bg-zinc-900" style={{ width: `${progressPct}%` }} />
                </div>

                <div className="mt-2 text-xs text-zinc-600">{needText}</div>
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
                Manual distribution: admins will verify eligibility & proof. <b>No private keys</b> required.
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer safety */}
      <div className="rounded-2xl border border-zinc-900/10 bg-white/70 p-5 text-sm text-zinc-700">
        <div className="font-semibold text-zinc-900">Safety</div>
        <div className="mt-2">
          WAOC will <b>never</b> ask for seed phrases or private keys. Verify only via official links inside this site.
        </div>
      </div>
    </div>
  );
}
