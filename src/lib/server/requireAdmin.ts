import { verifyAdminSignature } from "@/lib/server/adminSig";
import { ADMIN_SESSION_COOKIE, readAdminSession } from "@/lib/server/adminSession";

export async function requireAdmin(req: Request) {
  // 1) ✅ 先看 cookie session
  const token =
    String(req.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((x) => x.startsWith(ADMIN_SESSION_COOKIE + "="))
      ?.split("=")[1] || "";

  const sess = await readAdminSession(token);
  if (sess.ok && sess.wallet) {
    return { ok: true as const, wallet: sess.wallet, via: "session" as const };
  }

  // 2) fallback：兼容你现在的签名 headers
  const auth = verifyAdminSignature(req);
  if (!auth.ok) return { ok: false as const, error: auth.error };
  return { ok: true as const, wallet: auth.wallet, via: "sig" as const };
}
