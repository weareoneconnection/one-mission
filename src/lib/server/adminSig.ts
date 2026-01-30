// src/lib/server/adminSig.ts
import bs58 from "bs58";
import nacl from "tweetnacl";

type Ok = { ok: true; wallet: string; action: string };
type Err = {
  ok: false;
  error:
    | "missing_admin_headers"
    | "admin_action_not_allowed"
    | "admin_signature_expired"
    | "invalid_admin_signature"
    | "invalid_admin_timestamp";
};

export type AdminAuth = Ok | Err;

/**
 * ✅ 只允许“登录”这一个动作走签名头
 * 目的：Admin Login 签一次，后续接口走 httpOnly session cookie，不再连续签名
 *
 * 你后端 session route：POST /api/mission/admin/session
 */
const ALLOW_PREFIXES = new Set<string>([
  "POST:/api/mission/admin/session",
]);

// 防重放窗口（默认 5 分钟）
const MAX_SKEW_MS = 5 * 60 * 1000;

function getHeader(req: Request, name: string) {
  // Next.js Headers 是 case-insensitive，但这里双取更稳
  return req.headers.get(name) || req.headers.get(name.toLowerCase()) || "";
}

function parseActionPrefix(msg: string) {
  // msg 可能是：POST:/api/mission/admin/session|body=...|cluster=...
  // ✅ 只取第一个 | 前的内容作为 allowlist key
  const first = msg.split("|", 1)[0] || "";
  return first.trim();
}

function isFreshTimestamp(tsStr: string) {
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return false;
  const now = Date.now();
  return Math.abs(now - ts) <= MAX_SKEW_MS;
}

/**
 * ✅ 验证 Admin 签名头
 * 规则（与你现有实现保持一致）：
 * - 必须带：
 *    x-admin-wallet
 *    x-admin-msg
 *    x-admin-timestamp (or x-admin-ts)
 *    x-admin-signature (or x-admin-sig)
 * - allowlist：只校验 msg 的前缀（METHOD:/api/xxx）
 * - payload：`${msg}|${timestamp}`
 * - signature：tweetnacl detached verify
 */
export async function verifyAdminSig(req: Request): Promise<AdminAuth> {
  const wallet = getHeader(req, "x-admin-wallet");
  const msg = getHeader(req, "x-admin-msg");

  const timestamp =
    getHeader(req, "x-admin-timestamp") ||
    getHeader(req, "x-admin-ts") ||
    "";

  const sig =
    getHeader(req, "x-admin-signature") ||
    getHeader(req, "x-admin-sig") ||
    "";

  if (!wallet || !msg || !timestamp || !sig) {
    return { ok: false, error: "missing_admin_headers" };
  }

  // ✅ allowlist：只允许登录动作
  const action = parseActionPrefix(msg);
  if (!ALLOW_PREFIXES.has(action)) {
    return { ok: false, error: "admin_action_not_allowed" };
  }

  // ✅ 时间窗（防重放）
  if (!isFreshTimestamp(timestamp)) {
    return { ok: false, error: "admin_signature_expired" };
  }

  // ✅ 验签：payload = msg|timestamp
  try {
    const payload = `${msg}|${timestamp}`;

    const sigBytes = bs58.decode(sig);
    const pubBytes = bs58.decode(wallet);

    const ok = nacl.sign.detached.verify(
      Buffer.from(payload, "utf8"),
      sigBytes,
      pubBytes
    );

    if (!ok) return { ok: false, error: "invalid_admin_signature" };
    return { ok: true, wallet, action };
  } catch {
    return { ok: false, error: "invalid_admin_signature" };
  }
}
