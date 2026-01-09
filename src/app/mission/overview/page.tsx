"use client";

import Link from "next/link";
import { useMemo } from "react";
import { mockMissions } from "@/lib/mission/mock";

type Mission = {
  id: string;
  title: string;
  description?: string;
  category?: string;
  points?: number;
  completed?: boolean;
};

const PRIZE_POOL_SOL = 0; // ✅ 不展示 SOL（结构不变）
const PRIZE_POOL_WAOC = 5_000_000; // ✅ 改成 5,000,000 WAOC
const EVENT_STATUS: "LIVE" | "UPCOMING" | "ENDED" = "LIVE"; // ✅ 改成真实状态
const RESET_RULE = "Daily reset at 00:00 UTC"; // ✅ 改成真实规则
const VERIFICATION_NOTE =
  "Verification is on-chain / wallet-based where applicable. No private keys required.";
const PRIMARY_CTA_HREF = "/mission/missions"; // ✅ 你的真正任务执行入口
const SECONDARY_CTA_HREF = "/mission/rewards";

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-white px-3 py-1 text-xs font-medium">
      {children}
    </span>
  );
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
    <div className="rounded-2xl border bg-white p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-2 text-sm text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function SectionTitle({
  eyebrow,
  title,
  desc,
}: {
  eyebrow?: string;
  title: string;
  desc?: string;
}) {
  return (
    <div className="space-y-2">
      {eyebrow ? (
        <div className="text-xs font-medium tracking-wide text-muted-foreground">
          {eyebrow}
        </div>
      ) : null}
      <h2 className="text-xl md:text-2xl font-semibold">{title}</h2>
      {desc ? <p className="text-sm md:text-base text-muted-foreground">{desc}</p> : null}
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
        active ? "bg-black text-white border-black" : "bg-white",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function fmtNumber(n: number) {
  return new Intl.NumberFormat("en-US").format(n);
}

export default function MissionOverviewPage() {
  const featured = useMemo(() => {
    const list = (mockMissions as Mission[]) || [];
    // 优先显示 points 高/标题有代表性的任务，最多 6 个
    return [...list]
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
      .slice(0, 6);
  }, []);

  const statusLabel =
    EVENT_STATUS === "LIVE"
      ? "Live Now"
      : EVENT_STATUS === "UPCOMING"
      ? "Starting Soon"
      : "Ended";

  const statusTone =
    EVENT_STATUS === "LIVE"
      ? "bg-green-50 border-green-200 text-green-700"
      : EVENT_STATUS === "UPCOMING"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-muted/30 border-muted text-muted-foreground";

  return (
    <div className="space-y-10">
      {/* =================== HERO =================== */}
      <div className="rounded-3xl border bg-white p-6 md:p-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="space-y-4 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs ${statusTone}`}>
                {statusLabel}
              </span>
              <Badge>One Mission</Badge>
              <Badge>WAOC Ecosystem</Badge>
              <Badge>Points → Rewards</Badge>
            </div>

            <h1 className="text-2xl md:text-4xl font-semibold leading-tight">
              Complete missions, build reputation, unlock rewards.
            </h1>

            <p className="text-sm md:text-base text-muted-foreground">
              One Mission is the public mission campaign for WAOC. Earn points by completing
              community + on-chain + growth missions, then unlock rewards from the prize pool.
            </p>

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href={PRIMARY_CTA_HREF}
                className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:opacity-90"
              >
                Start Missions
              </Link>
              <Link
                href={SECONDARY_CTA_HREF}
                className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted"
              >
                View Rewards
              </Link>
            </div>

            <div className="text-xs text-muted-foreground pt-1">
              {VERIFICATION_NOTE}
            </div>
          </div>

          {/* Right panel */}
          <div className="w-full md:w-[360px] space-y-3">
            <div className="rounded-2xl border bg-muted/20 p-5">
              <div className="text-xs text-muted-foreground">Prize Pool</div>

              {/* ✅ 只改这一行：不显示 SOL，只显示 5,000,000 WAOC */}
              <div className="mt-1 text-2xl font-semibold">
                {fmtNumber(PRIZE_POOL_WAOC)} WAOC
              </div>

              <div className="mt-2 text-sm text-muted-foreground">
                Distributed by points & milestones.
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-5 space-y-2">
              <div className="text-xs text-muted-foreground">Reset Rule</div>
              <div className="text-sm font-medium">{RESET_RULE}</div>
              <div className="text-xs text-muted-foreground">
                Some missions may be one-time, others can reset.
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-5 space-y-2">
              <div className="text-xs text-muted-foreground">Safety</div>
              <div className="text-sm">
                WAOC will <b>never</b> ask for seed phrases or private keys.
              </div>
              <div className="text-xs text-muted-foreground">
                Verify only via official links inside this site.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* =================== STATS =================== */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Participants" value="—" sub="Connect wallet to join." />
        <StatCard
          label="Missions"
          value={(mockMissions as Mission[]).length}
          sub="Growth · On-chain · Community"
        />
        <StatCard label="Points Issued" value="—" sub="Updates as missions verified." />
        <StatCard label="Your Status" value="Connected" sub="Go to Missions to verify." />
      </div>

      {/* =================== HOW IT WORKS =================== */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-6">
          <SectionTitle
            eyebrow="HOW IT WORKS"
            title="Simple flow, real incentives"
            desc="Overview is for public explanation. Missions is where you actually execute & verify tasks."
          />
          <div className="mt-5 space-y-3 text-sm">
            {[
              { k: "1", t: "Connect wallet", d: "Use the same wallet to build a consistent reputation." },
              { k: "2", t: "Complete missions", d: "Follow, join, contribute, on-chain actions (where applicable)." },
              { k: "3", t: "Verify & earn points", d: "Verification prevents repeated clicks & keeps fairness." },
              { k: "4", t: "Unlock rewards", d: "Rewards unlock by points thresholds & milestones." },
            ].map((x) => (
              <div key={x.k} className="flex gap-3 rounded-xl border bg-muted/10 p-4">
                <div className="h-7 w-7 shrink-0 rounded-lg border bg-white flex items-center justify-center text-xs font-semibold">
                  {x.k}
                </div>
                <div>
                  <div className="font-medium">{x.t}</div>
                  <div className="text-muted-foreground">{x.d}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Pill active>Transparent</Pill>
            <Pill>Anti-spam</Pill>
            <Pill>Points-based</Pill>
            <Pill>Reward thresholds</Pill>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-6">
          <SectionTitle
            eyebrow="REWARDS"
            title="Prize pool distribution"
            desc="Show a clear, public-facing reward ladder. Keep details inside Rewards page."
          />

          <div className="mt-5 space-y-3 text-sm">
            {[
              { t: "Tier 1", p: "≥ 200 pts", d: "Starter perks / community role" },
              { t: "Tier 2", p: "≥ 600 pts", d: "Early access / whitelist eligibility" },
              { t: "Tier 3", p: "≥ 1200 pts", d: "Bonus rewards / priority drops" },
              { t: "Tier 4", p: "≥ 2000 pts", d: "Top contributor pool / special rewards" },
            ].map((r) => (
              <div key={r.t} className="rounded-xl border bg-muted/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium">{r.t}</div>
                  <Badge>{r.p}</Badge>
                </div>
                <div className="mt-2 text-muted-foreground">{r.d}</div>
              </div>
            ))}
          </div>

          <div className="mt-5">
            <Link
              href={SECONDARY_CTA_HREF}
              className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted"
            >
              See full Rewards details
            </Link>
          </div>
        </div>
      </div>

      {/* =================== FEATURED MISSIONS (PREVIEW) =================== */}
      <div className="rounded-2xl border bg-white p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <SectionTitle
            eyebrow="FEATURED"
            title="Featured missions (preview)"
            desc="Only preview here. Go to Missions page to execute & verify."
          />
          <Link
            href={PRIMARY_CTA_HREF}
            className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            Go to Missions →
          </Link>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {featured.map((m) => (
            <div key={m.id} className="rounded-2xl border bg-muted/10 p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-semibold">{m.title}</div>
                  {m.description ? (
                    <div className="text-sm text-muted-foreground">{m.description}</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      Complete this mission to earn points.
                    </div>
                  )}
                </div>
                <Badge>{(m.points ?? 0) > 0 ? `+${m.points} pts` : "Points"}</Badge>
              </div>

              <div className="flex flex-wrap gap-2">
                <Pill>{m.category ?? "General"}</Pill>
                {m.completed ? <Pill active>Completed</Pill> : <Pill>Not done</Pill>}
              </div>

              <div className="pt-1">
                <Link
                  href={PRIMARY_CTA_HREF}
                  className="inline-flex items-center justify-center rounded-xl border px-4 py-2 text-sm font-medium hover:bg-muted"
                >
                  Open in Missions
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* =================== FAQ =================== */}
      <div className="rounded-2xl border bg-white p-6">
        <SectionTitle
          eyebrow="FAQ"
          title="Common questions"
          desc="Keep the answers short here; full details can live in Docs later."
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {[
            {
              q: "Do I need to pay anything?",
              a: "No. Some missions may require on-chain actions, but One Mission itself does not require payment.",
            },
            {
              q: "Why points instead of instant rewards?",
              a: "Points enable fair distribution and reduce spam. Rewards unlock by thresholds and milestones.",
            },
            {
              q: "How do you verify tasks?",
              a: "Depending on mission type: wallet checks, signatures, or community verification logic (no private keys).",
            },
            {
              q: "Where do I actually do tasks?",
              a: "Go to the Missions page. Overview is only the public landing page.",
            },
          ].map((x) => (
            <div key={x.q} className="rounded-2xl border bg-muted/10 p-5">
              <div className="font-medium">{x.q}</div>
              <div className="mt-2 text-sm text-muted-foreground">{x.a}</div>
            </div>
          ))}
        </div>
      </div>

      {/* =================== FINAL CTA =================== */}
      <div className="rounded-3xl border bg-white p-6 md:p-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm text-muted-foreground">Ready to participate?</div>
          <div className="text-xl md:text-2xl font-semibold">
            Start your first mission and climb the leaderboard.
          </div>
        </div>
        <div className="flex gap-3">
          <Link
            href={PRIMARY_CTA_HREF}
            className="inline-flex items-center justify-center rounded-xl bg-black px-5 py-3 text-sm font-medium text-white hover:opacity-90"
          >
            Start Missions
          </Link>
          <Link
            href="/mission/leaderboard"
            className="inline-flex items-center justify-center rounded-xl border px-5 py-3 text-sm font-medium hover:bg-muted"
          >
            Leaderboard
          </Link>
        </div>
      </div>
    </div>
  );
}
