import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

function nowMs() {
  return Date.now();
}

/**
 * ✅ Admin action 白名单
 * 不改结构，只集中管理
 */
const ADMIN_ACTIONS = new Set<string>([
  "POST:/api/mission/admin/session", // ✅ 新增这一行（Admin Login）
  "POST:/api/mission/approve",
  "POST:/api/mission/reject",
  "POST:/api/points/sync",
]);


/**
 * 从 Request 推导 “规范 action”
 * 例：POST + /api/points/sync => POST:/api/points/sync
 */
function inferAction(req: Request): string {
  const method = (req.method || "GET").toUpperCase();
  let pathname = "/";
  try {
    pathname = new URL(req.url).pathname;
  } catch {}
  return `${method}:${pathname}`;
}

export function verifyAdminSignature(req: Request) {
  const wallet = String(req.headers.get("x-admin-wallet") || "").trim();
  const ts = String(req.headers.get("x-admin-timestamp") || "").trim();
  const msg = String(req.headers.get("x-admin-msg") || "").trim();
  const sig = String(req.headers.get("x-admin-signature") || "").trim();

  if (!wallet) return { ok: false as const, error: "missing_admin_wallet" };
  if (!ts) return { ok: false as const, error: "missing_admin_timestamp" };
  if (!msg) return { ok: false as const, error: "missing_admin_msg" };
  if (!sig) return { ok: false as const, error: "missing_admin_signature" };

  // ✅ 时间窗（5 分钟），防重放
  const t = Number(ts);
  if (!Number.isFinite(t)) return { ok: false as const, error: "bad_admin_timestamp" };

  const drift = Math.abs(nowMs() - t);
  if (drift > 5 * 60 * 1000) {
    return { ok: false as const, error: "admin_timestamp_expired" };
  }

  // ✅ 强约束：action 必须在白名单里
  if (!ADMIN_ACTIONS.has(msg)) {
    return {
      ok: false as const,
      error: "admin_action_not_allowed",
      detail: msg,
    };
  }

  // ✅ 强校验：签名 action 必须等于当前请求 action
  const inferred = inferAction(req);
  if (msg !== inferred) {
    return {
      ok: false as const,
      error: "admin_msg_mismatch",
      signed: msg,
      actual: inferred,
    };
  }

  // ✅ payload = msg|timestamp
  const payload = `${msg}|${ts}`;

  let pubkeyBytes: Uint8Array;
  let sigBytes: Uint8Array;

  try {
    pubkeyBytes = new PublicKey(wallet).toBytes();
  } catch {
    return { ok: false as const, error: "bad_admin_wallet" };
  }

  try {
    sigBytes = bs58.decode(sig);
  } catch {
    return { ok: false as const, error: "bad_admin_signature" };
  }

  const ok = nacl.sign.detached.verify(
    Buffer.from(payload, "utf8"),
    sigBytes,
    pubkeyBytes
  );

  if (!ok) {
    return { ok: false as const, error: "admin_signature_invalid" };
  }

  return {
    ok: true as const,
    wallet,
    action: msg,
    ts: t,
  };
}
