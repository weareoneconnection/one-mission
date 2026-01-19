"use client";

import React, { useMemo, useState, useEffect } from "react";
import type { Mission } from "@/lib/mission/types";
import { useMission } from "@/lib/mission/store";

function parsePeriod(id: string): "daily" | "weekly" | "once" {
  const s = (id || "").trim();
  const idx = s.indexOf(":");
  if (idx > 0) {
    const p = s.slice(0, idx).toLowerCase();
    if (p === "daily" || p === "weekly" || p === "once") return p as any;
  }
  return "once";
}

function periodLabel(p: "daily" | "weekly" | "once") {
  if (p === "daily") return "Daily";
  if (p === "weekly") return "Weekly";
  return "Once";
}

function statusLabel(status: Mission["status"], period: "daily" | "weekly" | "once", isPending: boolean) {
  if (isPending) return "Submitted";
  if (status === "cooldown") return "Verifying";
  if (status === "locked") return "Locked";
  if (status === "completed") {
    if (period === "daily") return "Claimed (Today)";
    if (period === "weekly") return "Claimed (This Week)";
    return "Completed";
  }
  return "Available";
}

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warn" | "muted";
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-900"
      : tone === "muted"
      ? "border-zinc-900/10 bg-white/60 text-zinc-600"
      : "border-zinc-900/10 bg-white text-zinc-800";

  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${cls}`}>{children}</span>;
}

function OnchainInfo({ mission }: { mission: Mission }) {
  const oc: any = (mission as any).onchain;
  if (!oc) return null;

  const kind = String(oc.kind || "").toLowerCase();
  if (kind === "sol") {
    const lamports = typeof oc.minLamports === "number" ? oc.minLamports : 0;
    const sol = lamports ? lamports / 1_000_000_000 : 0.1;
    return (
      <div className="text-xs text-zinc-600">
        On-chain: Hold ≥ <b>{sol.toFixed(2)} SOL</b>
      </div>
    );
  }
  if (kind === "spl") {
    const minAmount = typeof oc.minAmount === "number" ? oc.minAmount : 0;
    return (
      <div className="text-xs text-zinc-600">
        On-chain: Hold ≥ <b>{minAmount.toLocaleString("en-US")} WAOC</b>
      </div>
    );
  }
  if (kind === "nft") {
    return (
      <div className="text-xs text-zinc-600">
        On-chain: Own <b>WAOC Genesis NFT</b>
      </div>
    );
  }
  return null;
}

// ---- periodKey (跟你 store 里 UTC 一致，避免 daily/weekly 错位) ----
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
function periodKeyFor(period: "daily" | "weekly" | "once") {
  if (period === "daily") return todayKeyUTC();
  if (period === "weekly") return isoWeekKeyUTC();
  return "once";
}

// ---- file to dataUrl ----
async function fileToDataUrl(file: File) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return `data:${file.type};base64,${base64}`;
}

type VerifyType = "SOL" | "SPL" | "NFT_COLLECTION";

export default function MissionCard({
  mission,
  onVerify,
}: {
  mission: Mission;
  onVerify: () => void;
}) {
  const { errors, walletAddress, verifyingId } = useMission();
  const err = errors[mission.id];

  const [dismissedError, setDismissedError] = useState(false);

  // ✅ 本地错误（用于接住 verify-onchain 的真实 HTTP 状态和 error）
  const [localErr, setLocalErr] = useState<string | null>(null);

  const period = useMemo(() => parsePeriod(mission.id), [mission.id]);

  const isLocked = mission.status === "locked";
  const isCompleted = mission.status === "completed";
  const isVerifying = mission.status === "cooldown" || verifyingId === mission.id;

  // ✅ 判断是否需要人工审核（你可按你的 mission 配置改规则）
  // 规则：非 onchain 且 非“自动claim”的任务，都走 submit proof
  const requiresProof = Boolean((mission as any).requiresProof) || !Boolean((mission as any).onchain);

  // ✅ 本地 pending：提交后给用户一个“等待审核”的明确状态
  const [pending, setPending] = useState(false);
  const pendingKey = useMemo(() => {
    const pk = periodKeyFor(period);
    return walletAddress ? `pending:${walletAddress}:${mission.id}:${pk}` : null;
  }, [walletAddress, mission.id, period]);

  useEffect(() => {
    if (!pendingKey) return;
    const v = sessionStorage.getItem(pendingKey);
    setPending(v === "1");
  }, [pendingKey]);

  const canAct = !isLocked && !isCompleted && !isVerifying && !pending;

  const showError = useMemo(() => {
    if (dismissedError) return false;
    return Boolean(localErr || err);
  }, [err, localErr, dismissedError]);

  const tone =
    pending ? "muted" : isCompleted ? "success" : isLocked ? "warn" : isVerifying ? "muted" : "default";

  const badgeStatus = statusLabel(mission.status, period, pending);

  // CTA label
  const ctaLabel = pending
    ? "Waiting for admin"
    : isVerifying
    ? "Verifying…"
    : isLocked
    ? "Locked"
    : isCompleted
    ? "Claimed"
    : requiresProof
    ? "Submit proof"
    : period === "daily"
    ? "Claim (Daily)"
    : period === "weekly"
    ? "Claim (Weekly)"
    : "Verify";

  // ---------- Proof Modal ----------
  const [open, setOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<{ name: string; type: string; size: number; dataUrl: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [modalErr, setModalErr] = useState<string | null>(null);

  async function onPickFiles(list: FileList | null) {
    if (!list) return;
    setModalErr(null);

    const picked = Array.from(list);
    const allow = new Set(["image/png", "image/jpeg", "image/webp"]);
    const maxFiles = 3;
    const maxSize = 2 * 1024 * 1024;

    const next: typeof files = [];
    for (const f of picked) {
      if (next.length >= maxFiles) break;
      if (!allow.has(f.type)) continue;
      if (f.size <= 0 || f.size > maxSize) continue;

      const dataUrl = await fileToDataUrl(f);
      next.push({ name: f.name, type: f.type, size: f.size, dataUrl });
    }

    if (next.length === 0) {
      setModalErr("Only PNG/JPG/WebP screenshots up to 2MB are allowed.");
      return;
    }

    setFiles(next);
  }

  async function submitProof() {
    if (!walletAddress) return;
    setSubmitting(true);
    setModalErr(null);

    try {
      const pk = periodKeyFor(period);

      const r = await fetch("/api/mission/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          wallet: walletAddress,
          missionId: mission.id,
          periodKey: pk,
          points: mission.basePoints,
          proofUrl: proofUrl.trim(),
          note: note.trim(),
          files,
        }),
      });

      const j = await r.json().catch(() => ({} as any));
      if (!r.ok || !j?.ok) throw new Error(j?.error || `Submit failed (HTTP ${r.status})`);

      // ✅ 立即进入 pending 状态（不等 admin）
      if (pendingKey) sessionStorage.setItem(pendingKey, "1");
      setPending(true);

      // reset + close
      setProofUrl("");
      setNote("");
      setFiles([]);
      setOpen(false);
    } catch (e: any) {
      setModalErr(e?.message ?? "Submit error");
    } finally {
      setSubmitting(false);
    }
  }

  // ✅ Onchain verify (对齐后端 /api/verify-onchain: verifyType + address)
  async function verifyOnchain() {
    if (!walletAddress) return;

    const oc: any = (mission as any).onchain;
    const kind = String(oc?.kind || "").toLowerCase();

    let verifyType: VerifyType = "SPL";
    const payload: any = { address: walletAddress };

    if (kind === "sol") {
      verifyType = "SOL";
      const lamports = typeof oc?.minLamports === "number" ? oc.minLamports : 100_000_000; // default 0.1 SOL
      payload.minSol = lamports / 1_000_000_000;
    } else if (kind === "spl") {
      verifyType = "SPL";
      payload.minAmount = typeof oc?.minAmount === "number" ? oc.minAmount : 10_000;
      // mint 可不传，后端会 fallback 到 WAOC_MINT
      // payload.mint = oc?.mint;
    } else if (kind === "nft") {
      verifyType = "NFT_COLLECTION";
      // collectionMint 可不传，后端会 fallback 到 WAOC_GENESIS_COLLECTION_MINT
      // payload.collectionMint = oc?.collectionMint;
    } else {
      // 没有 kind 的情况下，默认当作 SPL 10000
      verifyType = "SPL";
      payload.minAmount = 10_000;
    }

    const r = await fetch("/api/verify-onchain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ verifyType, ...payload }),
    });

    const j = await r.json().catch(() => ({} as any));

    if (!r.ok || !j?.ok) {
      throw new Error(j?.error ? `${j.error} (HTTP ${r.status})` : `HTTP ${r.status}`);
    }

    // ✅ 成功后，交给外层刷新（不改变结构）
    onVerify();
  }

  return (
    <div
      className={["rounded-2xl border border-zinc-900/10 bg-white/70 p-5", isCompleted ? "opacity-[0.92]" : ""].join(
        " "
      )}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        {/* Left */}
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Pill>{mission.category}</Pill>
            <Pill tone="muted">{periodLabel(period)}</Pill>
            <Pill tone={tone}>{badgeStatus}</Pill>
            <Pill>+{mission.basePoints} pts</Pill>
            {requiresProof ? <Pill tone="muted">Proof</Pill> : null}
          </div>

          <div className="text-base md:text-lg font-semibold text-zinc-900">{mission.title}</div>

          {mission.description ? <div className="text-sm text-zinc-600 leading-relaxed">{mission.description}</div> : null}

          <OnchainInfo mission={mission} />

          {!walletAddress && (mission as any).onchain ? (
            <div className="text-xs text-zinc-500">Tip: connect wallet before verifying on-chain missions.</div>
          ) : null}

          {period !== "once" ? (
            <div className="text-[11px] text-zinc-500">
              Resets {period === "daily" ? "daily at 00:00 UTC" : "weekly (UTC)"}.
            </div>
          ) : null}

          {pending ? <div className="text-xs text-zinc-600">✅ Submitted. Please wait for admin approval.</div> : null}
        </div>

        {/* Right action */}
        <div className="shrink-0 flex items-center gap-2 md:flex-col md:items-end">
          {isCompleted ? (
            <span className="inline-flex items-center justify-center rounded-xl border border-zinc-900/10 bg-white px-5 py-2 text-sm font-semibold text-zinc-700">
              {period === "daily" ? "Claimed Today" : period === "weekly" ? "Claimed This Week" : "Verified"}
            </span>
          ) : (
            <button
              type="button"
              disabled={!canAct}
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();

                setDismissedError(false);
                setLocalErr(null);

                if (!walletAddress) return;

                // ✅ 需要 proof 的走弹窗，不走 verify
                if (requiresProof) {
                  setOpen(true);
                  return;
                }

                // ✅ onchain 任务：直接调用 verify-onchain（对齐后端参数）
                const isOnchain = Boolean((mission as any).onchain);

                try {
                  if (isOnchain) {
                    await verifyOnchain();
                  } else {
                    // ✅ 非 onchain 且不需要 proof：保持原结构（交给外层）
                    onVerify();
                  }
                } catch (e: any) {
                  setLocalErr(e?.message ?? "Verify failed");
                }
              }}
              className={[
                "inline-flex items-center justify-center rounded-xl px-5 py-2 text-sm font-semibold transition",
                canAct ? "bg-black text-white hover:bg-black/90" : "bg-zinc-200 text-zinc-500 cursor-not-allowed",
              ].join(" ")}
            >
              {ctaLabel}
            </button>
          )}

          <div className="hidden md:block text-xs text-zinc-500">
            {pending ? "Awaiting approval…" : isVerifying ? "Please wait…" : isLocked ? "Not eligible yet" : " "}
          </div>
        </div>
      </div>

      {/* Error box */}
      {showError ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-800 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Verification failed</div>
            <div className="text-red-800/80">{localErr || err}</div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedError(true)}
            className="shrink-0 text-xs underline text-red-700"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Proof Modal */}
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => (submitting ? null : setOpen(false))} />
          <div className="relative w-full max-w-2xl rounded-[28px] border border-zinc-900/10 bg-[#fbfaf7] shadow-2xl overflow-hidden">
            <div className="flex items-start justify-between gap-4 p-6">
              <div className="min-w-0">
                <div className="text-xs font-semibold tracking-wide text-zinc-500">Submit proof</div>
                <div className="mt-1 text-3xl font-extrabold text-zinc-900 leading-tight">{mission.title}</div>
                <div className="mt-2 text-sm text-zinc-600">
                  Paste a link and/or upload screenshots to prove you completed the task.
                </div>
              </div>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setOpen(false)}
                className="shrink-0 rounded-2xl border border-zinc-900/10 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-white/90"
              >
                Close
              </button>
            </div>

            <div className="px-6 pb-6 space-y-5">
              {/* Proof link */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-zinc-900">
                  Proof link <span className="text-zinc-500 font-normal">(recommended)</span>
                </div>
                <input
                  value={proofUrl}
                  onChange={(e) => setProofUrl(e.target.value)}
                  placeholder="https://x.com/... or https://t.me/... or https://github.com/..."
                  className="w-full rounded-2xl border border-zinc-900/10 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
                />
                <div className="text-xs text-zinc-500">Paste a link that proves you did it (tweet / TG message / repo / etc).</div>
              </div>

              {/* Upload */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-zinc-900">
                  Screenshot <span className="text-zinc-500 font-normal">(optional)</span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-2xl border border-zinc-900/10 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 hover:bg-white/90">
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => onPickFiles(e.target.files)}
                    />
                  </label>

                  <div className="text-xs text-zinc-500">PNG/JPG/WebP • up to 2MB each • max 3 files</div>
                </div>

                {files.length ? (
                  <div className="grid grid-cols-3 gap-3 pt-2">
                    {files.map((f, idx) => (
                      <div key={idx} className="rounded-2xl border border-zinc-900/10 bg-white p-2">
                        <img src={f.dataUrl} alt={f.name} className="h-24 w-full rounded-xl object-cover" />
                        <div className="mt-2 truncate text-[11px] text-zinc-600">{f.name}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <div className="text-sm font-semibold text-zinc-900">
                  Notes <span className="text-zinc-500 font-normal">(optional)</span>
                </div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Short description of what you did..."
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-zinc-900/10 bg-white px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-black/10"
                />
              </div>

              {modalErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{modalErr}</div>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setOpen(false)}
                  className="rounded-2xl border border-zinc-900/10 bg-white px-5 py-2 text-sm font-semibold text-zinc-700 hover:bg-white/90"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={submitting || (!proofUrl.trim() && files.length === 0 && !note.trim())}
                  onClick={submitProof}
                  className={[
                    "rounded-2xl px-6 py-2 text-sm font-semibold transition",
                    submitting ? "bg-zinc-200 text-zinc-500 cursor-not-allowed" : "bg-black text-white hover:bg-black/90",
                  ].join(" ")}
                >
                  {submitting ? "Submitting…" : "Submit for review"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
