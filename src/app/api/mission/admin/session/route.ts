import { NextResponse } from "next/server";
import { verifyAdminSig } from "@/lib/server/adminSig";
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
  // ✅ 只在登录时验签
  const auth = await verifyAdminSig(req);
  if (!auth.ok) return noStoreJson({ ok: false, error: auth.error }, 401);

  const created = await createAdminSession(auth.wallet);
  if (!created.ok) return noStoreJson({ ok: false, error: created.error }, 403);

  const res = noStoreJson({ ok: true, isAdmin: true, wallet: created.wallet, ttl: created.ttl });

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
  // ✅ logout 清 session
  const token =
    String(req.headers.get("cookie") || "")
      .split(";")
      .map((s) => s.trim())
      .find((x) => x.startsWith(ADMIN_SESSION_COOKIE + "="))
      ?.split("=")[1] || "";

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
  // ✅ 前端用来判断是否已登录
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
