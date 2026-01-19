import { NextResponse } from "next/server";
import { verifyAdminSignature } from "@/lib/server/adminSig";
import {
  ADMIN_SESSION_COOKIE,
  createAdminSession,
  destroyAdminSession,
  readAdminSession,
} from "@/lib/server/adminSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

export async function POST(req: Request) {
  // ✅ 用你现有的签名头做一次“管理员登录”
  const auth = verifyAdminSignature(req);
  if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, 401);

  const created = await createAdminSession(auth.wallet);
  if (!created.ok) return noStoreJson({ ok: false, error: created.error }, 403);

  const res = noStoreJson({ ok: true, isAdmin: true, wallet: created.wallet, ttl: created.ttl });

  // ✅ httpOnly cookie：前端拿不到，安全；30min 自动失效
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: created.token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: created.ttl,
  });

  return res;
}

export async function DELETE(req: Request) {
  const cookie = (req as any).cookies?.get?.(ADMIN_SESSION_COOKIE)?.value;
  // Next.js 的 Request 在 route.ts 里不一定有 cookies getter，兼容处理：
  const token =
    cookie ||
    String(req.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((x) => x.startsWith(ADMIN_SESSION_COOKIE + "="))
      ?.split("=")[1];

  await destroyAdminSession(token);

  const res = noStoreJson({ ok: true, loggedOut: true });
  res.cookies.set({
    name: ADMIN_SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}

export async function GET(req: Request) {
  // ✅ 查询当前是否已登录 admin（用于前端显示 Admin tab / gate）
  const token =
    String(req.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((x) => x.startsWith(ADMIN_SESSION_COOKIE + "="))
      ?.split("=")[1] || "";

  const s = await readAdminSession(token);
  if (!s.ok) return noStoreJson({ ok: true, isAdmin: false });

  return noStoreJson({ ok: true, isAdmin: true, wallet: s.wallet });
}
