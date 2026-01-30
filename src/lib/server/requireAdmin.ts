// src/lib/server/requireAdmin.ts
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/server/adminSession";

type Ok = { ok: true; wallet: string };
type Err = {
  ok: false;
  error:
    | "admin_session_required"
    | "invalid_admin_session"
    | "admin_not_allowed";
};

export type AdminCheck = Ok | Err;

function parseCsv(v: any) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getCookie(req: Request, name: string) {
  return (
    String(req.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((x) => x.startsWith(name + "="))
      ?.split("=")[1] || ""
  );
}

function isAllowedAdmin(wallet: string) {
  const allow = new Set<string>([
    ...parseCsv(process.env.MISSION_ADMIN_WALLETS),
    ...parseCsv(process.env.WAOC_ADMIN_WALLETS),
    String(process.env.ADMIN_WALLET || "").trim(),
    String(process.env.PRIMARY_ADMIN_WALLET || "").trim(),
  ]);

  // 清理空字符串
  for (const x of Array.from(allow)) if (!x) allow.delete(x);

  return allow.has(wallet);
}

/**
 * ✅ 恢复“原始路径”：只认 httpOnly session cookie
 * - pending/approve/reject 全走这个
 * - 不需要 x-admin-* 签名头
 */
export async function requireAdmin(req: Request): Promise<AdminCheck> {
  const token = getCookie(req, ADMIN_SESSION_COOKIE);
  if (!token) return { ok: false, error: "admin_session_required" };

  const s = await readAdminSession(token);
  if (!s.ok || !s.wallet) return { ok: false, error: "invalid_admin_session" };

  const wallet = String(s.wallet).trim();
  if (!wallet) return { ok: false, error: "invalid_admin_session" };

  if (!isAllowedAdmin(wallet)) return { ok: false, error: "admin_not_allowed" };

  return { ok: true, wallet };
}
