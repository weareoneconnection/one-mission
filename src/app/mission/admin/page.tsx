"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";

type PendingItem = {
  ts?: number;
  wallet?: string;
  missionId?: string;
  period?: "once" | "daily" | "weekly";
  periodKey?: string;

  proof?: any;
  note?: string;
  proofUrl?: string;
  files?: Array<{ name?: string; type?: string; size?: number; dataUrl?: string; url?: string }>;

  // ✅ 必须由后端生成并写入 pending
  submissionId?: string;

  raw?: any;
};

function fmtTime(ts?: number) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function clamp(n: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function shortWallet(w?: string) {
  if (!w) return "";
  if (w.length <= 10) return w;
  return `${w.slice(0, 4)}...${w.slice(-4)}`;
}

function copyToClipboard(s: string) {
  try {
    navigator.clipboard?.writeText(s);
  } catch {}
}

async function adminHeaders(walletAddress: string, signMessage: any) {
  const nonce = crypto.getRandomValues(new Uint32Array(4)).join("-");
  const ts = Date.now();
  const msg = `WAOC_ONE_MISSION_ADMIN|wallet=${walletAddress}|nonce=${nonce}|ts=${ts}`;
  const data = new TextEncoder().encode(msg);
  const sigBytes = await signMessage(data);
  const { default: bs58 } = await import("bs58");
  const sig = bs58.encode(sigBytes);

  return {
    "x-admin-wallet": walletAddress,
    "x-admin-msg": msg,
    "x-admin-sig": sig,
  };
}

function isHttpUrl(s: string) {
  return /^https?:\/\//i.test(s);
}

function safeUrl(v: any): string {
  if (!v) return "";
  if (typeof v === "function") return "";
  const s = String(v).trim();
  if (!s) return "";
  // 避免出现 "function link(){[native code]}" 这种
  if (s.startsWith("function ")) return "";
  if (s === "[object Object]") return "";
  return s;
}

function extractProof(it: PendingItem) {
  const p = it.proof ?? {};

  const urlCandidate =
    safeUrl(it.proofUrl) ||
    safeUrl(p.url) ||
    safeUrl(p.link) ||
    safeUrl(p.proofUrl) ||
    (typeof p === "string" && isHttpUrl(p) ? p : "");

  const url = isHttpUrl(urlCandidate) ? urlCandidate : "";

  const text = String(p.text || p.note || p.desc || it.note || "").trim();
  const tx = String(p.tx || p.signature || p.hash || "").trim();

  const filesRaw: any[] = Array.isArray(it.files)
    ? it.files
    : Array.isArray(p.files)
    ? p.files
    : Array.isArray(p.images)
    ? p.images
    : [];

  const images = filesRaw
    .map((f) => ({
      name: String(f?.name || ""),
      url: safeUrl(f?.dataUrl || f?.url || ""),
      type: String(f?.type || ""),
      size: Number(f?.size || 0) || 0,
    }))
    .filter((x) => x.url);

  return { url, text, tx, images, raw: it.proof };
}

export default function AdminPage() {
  const { publicKey, connected, signMessage } = useWallet();
  const walletAddress = useMemo(() => (publicKey ? publicKey.toBase58() : ""), [publicKey]);
  const canSign = Boolean(signMessage);

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [err, setErr] = useState<string>("");

  // ✅ 默认 50（不要 1000）
  const [limit, setLimit] = useState(50);

  const [adminSession, setAdminSession] = useState<{ ok: boolean; wallet?: string }>({ ok: false });
  const adminWallet = adminSession.ok ? adminSession.wallet || "" : "";

  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});

  const [lightbox, setLightbox] = useState<{ open: boolean; src?: string; title?: string }>({
    open: false,
  });

  const checkAdminSession = async () => {
    try {
      const r = await fetch("/api/mission/admin/session", { method: "GET", cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j?.ok) setAdminSession({ ok: true, wallet: j.wallet });
      else setAdminSession({ ok: false });
    } catch {
      setAdminSession({ ok: false });
    }
  };

  const adminLogin = async () => {
    setErr("");
    if (!connected || !walletAddress) return setErr("Connect admin wallet first.");
    if (!canSign) return setErr("Wallet must support signMessage (e.g., Phantom).");

    setLoading(true);
    try {
      const headers = await adminHeaders(walletAddress, signMessage);

      const r = await fetch("/api/mission/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        cache: "no-store",
        body: JSON.stringify({}),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) return setErr(j?.error || `Admin login failed (${r.status})`);

      setAdminSession({ ok: true, wallet: j.wallet });
    } catch (e: any) {
      setErr(e?.message || "Admin login failed");
    } finally {
      setLoading(false);
    }
  };

  const adminLogout = async () => {
    setErr("");
    setLoading(true);
    try {
      await fetch("/api/mission/admin/session", { method: "DELETE", cache: "no-store" }).catch(
        () => {}
      );
    } finally {
      setAdminSession({ ok: false });
      setLoading(false);
    }
  };

  useEffect(() => {
    checkAdminSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ 只改这里：永远用 slim=1（后端会去掉 dataUrl/base64）
  const loadPending = async () => {
    setErr("");
    if (!adminSession.ok) return setErr("Admin session required. Click Admin Login first.");

    setLoading(true);
    try {
      const lim = clamp(limit, 1, 1000);
      const r = await fetch(`/api/mission/pending?limit=${lim}&slim=1`, {
        method: "GET",
        cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) return setErr(j?.error || `Request failed (${r.status})`);
      setItems(Array.isArray(j.items) ? j.items : []);
    } catch (e: any) {
      setErr(e?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  };

  // ✅ 本地移除 + 失败回滚（避免 approve/reject 后全量 reload）
  const removeLocal = (sid: string) => {
    setItems((prev) => prev.filter((x) => x.submissionId !== sid));
  };

  const approveOne = async (it: PendingItem) => {
    setErr("");
    if (!adminSession.ok) return setErr("Admin session required. Click Admin Login first.");
    if (!it.submissionId) {
      return setErr("Missing submissionId. Backend must generate submissionId for each pending item.");
    }

    const sid = it.submissionId;
    const snapshot = items; // 回滚用

    // ✅ 先秒删（用户体感立即快）
    removeLocal(sid);

    setLoading(true);
    try {
      const r = await fetch(`/api/mission/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          submissionId: sid,
          note: "approved_by_admin",
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        // 回滚
        setItems(snapshot);
        return setErr(j?.error || `Approve failed (${r.status})`);
      }
    } catch (e: any) {
      setItems(snapshot);
      setErr(e?.message || "Approve failed");
    } finally {
      setLoading(false);
    }
  };

  const rejectOne = async (it: PendingItem) => {
    setErr("");
    if (!adminSession.ok) return setErr("Admin session required. Click Admin Login first.");
    if (!it.submissionId) {
      return setErr("Missing submissionId. Backend must generate submissionId for each pending item.");
    }

    const sid = it.submissionId;
    const snapshot = items;

    const reason = (rejectReason[sid] || "").trim() || "not_enough_proof";

    // ✅ 先秒删
    removeLocal(sid);

    setLoading(true);
    try {
      const r = await fetch(`/api/mission/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          submissionId: sid,
          reason,
          note: "",
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.ok) {
        setItems(snapshot);
        return setErr(j?.error || `Reject failed (${r.status})`);
      }
    } catch (e: any) {
      setItems(snapshot);
      setErr(e?.message || "Reject failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Lightbox */}
      {lightbox.open ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={() => setLightbox({ open: false })}
          />
          <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-black/70 shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 text-sm text-white/90">
              <div className="truncate">{lightbox.title || "Screenshot"}</div>
              <button
                className="rounded-xl bg-white/10 px-3 py-1.5 hover:bg-white/15"
                onClick={() => setLightbox({ open: false })}
              >
                Close
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightbox.src}
              alt={lightbox.title || "proof"}
              className="max-h-[80vh] w-full object-contain"
            />
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs text-zinc-600">ONE MISSION</div>
            <h1 className="mt-1 text-2xl font-semibold text-zinc-900">Admin Review</h1>
            <p className="mt-1 text-sm text-zinc-700">
              Review pending submissions. ✅ Requires <b>submissionId</b> from backend for correct
              approve/reject removal.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/mission/missions"
              className="rounded-xl border border-zinc-900/15 bg-white/60 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white"
            >
              Back to Missions
            </Link>

            <button
              type="button"
              onClick={loadPending}
              disabled={loading || !adminSession.ok}
              className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
            >
              {loading ? "Loading..." : "Load Pending"}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-700">Admin Session:</span>

          {adminSession.ok && adminWallet ? (
            <span className="rounded-full border border-zinc-900/10 bg-white px-3 py-1 font-semibold">
              {shortWallet(adminWallet)}
            </span>
          ) : (
            <span className="text-zinc-500">Not logged in</span>
          )}

          <button
            type="button"
            onClick={adminLogin}
            disabled={loading || !connected || !walletAddress || !canSign}
            className="rounded-xl border border-zinc-900/15 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-white disabled:opacity-60"
            title={!connected ? "Connect wallet first" : !canSign ? "Wallet must support signMessage" : ""}
          >
            {adminSession.ok ? "Re-login" : "Admin Login"}
          </button>

          <button
            type="button"
            onClick={adminLogout}
            disabled={loading || !adminSession.ok}
            className="rounded-xl border border-zinc-900/15 bg-white/60 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-white disabled:opacity-60"
          >
            Logout
          </button>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-zinc-600 text-xs">Limit</span>
            <input
              value={limit}
              onChange={(e) => setLimit(clamp(Number(e.target.value || 50), 1, 1000))}
              className="w-28 rounded-xl border border-zinc-900/15 bg-white/70 px-3 py-2 text-sm"
              type="number"
              min={1}
              max={1000}
            />
          </div>
        </div>

        {!adminSession.ok ? (
          <div className="mt-4 rounded-2xl border border-amber-500/20 bg-amber-50/60 p-3 text-sm text-amber-900">
            Admin is separate: connect your <b>admin wallet</b> and click <b>Admin Login</b>.
          </div>
        ) : null}

        {err ? (
          <div className="mt-4 rounded-2xl border border-rose-500/20 bg-rose-50/60 p-3 text-sm text-rose-900">
            {err}
          </div>
        ) : null}
      </div>

      {/* List */}
      <div className="rounded-3xl border border-zinc-900/10 bg-white/70 p-4">
        <div className="flex items-center justify-between px-2 pb-3">
          <div className="text-sm text-zinc-700">
            Pending items: <b>{items.length}</b>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="rounded-2xl border border-zinc-900/10 bg-white/60 p-8 text-center">
            <div className="text-base font-semibold">No pending submissions</div>
            <div className="mt-2 text-sm text-zinc-600">
              {adminSession.ok ? (
                <>
                  Click <b>Load Pending</b> to fetch items.
                </>
              ) : (
                <>
                  Click <b>Admin Login</b> first.
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            {items.map((it, idx) => {
              const pf = extractProof(it);
              const sid = it.submissionId || "";
              const hasSid = Boolean(sid);

              return (
                <div
                  key={(sid || `${it.wallet}|${it.missionId}|${it.periodKey || ""}`) + ":" + idx}
                  className="rounded-2xl border border-zinc-900/10 bg-white/60 p-4"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1 min-w-0">
                      <div className="text-sm font-semibold text-zinc-900">
                        {it.missionId || "unknown mission"}
                      </div>

                      {hasSid ? (
                        <div className="text-xs text-zinc-600">
                          Submission: <span className="font-mono">{sid}</span>
                        </div>
                      ) : (
                        <div className="mt-2 rounded-2xl border border-amber-500/20 bg-amber-50/60 p-3 text-sm text-amber-900">
                          ⚠️ Missing <b>submissionId</b>. Backend must generate it in pending queue,
                          otherwise approve/reject cannot remove items.
                        </div>
                      )}

                      <div className="text-xs text-zinc-600 flex flex-wrap items-center gap-2">
                        <span>
                          Wallet: <span className="font-mono">{it.wallet}</span>
                        </span>
                        {it.wallet ? (
                          <button
                            className="rounded-lg border border-zinc-900/10 bg-white px-2 py-1 text-[11px] hover:bg-white/90"
                            onClick={() => copyToClipboard(it.wallet || "")}
                          >
                            Copy
                          </button>
                        ) : null}
                      </div>

                      <div className="text-xs text-zinc-600">
                        Period: <b>{it.period || "?"}</b>{" "}
                        {it.periodKey ? (
                          <>
                            · Key: <span className="font-mono">{it.periodKey}</span>
                          </>
                        ) : null}
                      </div>

                      <div className="text-xs text-zinc-600">
                        Time: <b>{fmtTime(it.ts)}</b>
                      </div>

                      {pf.url ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Proof link</div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            <a
                              href={pf.url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-sm text-blue-700 underline"
                              title={pf.url}
                            >
                              {pf.url}
                            </a>
                            <button
                              className="rounded-lg border border-zinc-900/10 bg-white px-2 py-1 text-[11px] hover:bg-white/90"
                              onClick={() => copyToClipboard(pf.url)}
                            >
                              Copy
                            </button>
                            <a
                              href={pf.url}
                              target="_blank"
                              rel="noreferrer"
                              className="rounded-lg bg-black px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-black/90"
                            >
                              Open
                            </a>
                          </div>
                        </div>
                      ) : null}

                      {pf.text ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Notes</div>
                          <div className="mt-1 text-sm text-zinc-700 whitespace-pre-wrap break-words">
                            {pf.text}
                          </div>
                        </div>
                      ) : null}

                      {pf.tx ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Tx / Signature</div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="font-mono text-[12px] text-zinc-700 truncate">{pf.tx}</span>
                            <button
                              className="rounded-lg border border-zinc-900/10 bg-white px-2 py-1 text-[11px] hover:bg-white/90"
                              onClick={() => copyToClipboard(pf.tx)}
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {pf.images.length ? (
                        <div className="mt-3 rounded-2xl border border-zinc-900/10 bg-white/70 p-3">
                          <div className="text-xs font-semibold text-zinc-800">Screenshots</div>
                          <div className="mt-2 grid grid-cols-3 gap-2">
                            {pf.images.map((img, i) => (
                              <button
                                key={i}
                                className="group rounded-2xl border border-zinc-900/10 bg-white p-2 text-left hover:bg-white/90"
                                onClick={() =>
                                  setLightbox({ open: true, src: img.url, title: img.name || "Screenshot" })
                                }
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={img.url} alt={img.name || "proof"} className="h-24 w-full rounded-xl object-cover" />
                                <div className="mt-2 truncate text-[11px] text-zinc-600">
                                  {img.name || "image"}{" "}
                                  {img.size ? <span className="text-zinc-400">({Math.round(img.size / 1024)}KB)</span> : null}
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex w-full flex-col gap-2 md:w-[320px]">
                      <button
                        type="button"
                        onClick={() => approveOne(it)}
                        disabled={loading || !adminSession.ok || !hasSid}
                        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
                      >
                        Approve
                      </button>

                      <input
                        value={rejectReason[sid] || ""}
                        onChange={(e) => setRejectReason((p) => ({ ...p, [sid]: e.target.value }))}
                        placeholder="Reject reason (optional)"
                        disabled={!hasSid}
                        className="rounded-xl border border-zinc-900/15 bg-white/70 px-3 py-2 text-sm disabled:opacity-60"
                      />

                      <button
                        type="button"
                        onClick={() => rejectOne(it)}
                        disabled={loading || !adminSession.ok || !hasSid}
                        className="rounded-xl border border-rose-500/30 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-900 hover:bg-rose-100 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
