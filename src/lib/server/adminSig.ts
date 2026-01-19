import bs58 from "bs58";
import nacl from "tweetnacl";

type Res =
  | { ok: true; wallet: string; msg: string; ts: number; nonce: string }
  | { ok: false; error: string };

function parseAdminWallets(): string[] {
  const raw = String(process.env.MISSION_ADMIN_WALLETS || "").trim();
  if (!raw) return [];
  return raw
    .split(/[,\s]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function ttlSec(): number {
  const v = Number(process.env.MISSION_ADMIN_SIG_TTL_SEC || 600);
  return Number.isFinite(v) ? Math.max(60, Math.trunc(v)) : 600;
}

function bad(error: string): Res {
  return { ok: false, error };
}

export function verifyAdminSignature(req: Request): Res {
  try {
    const wallet = String(req.headers.get("x-admin-wallet") || "").trim();
    const msg = String(req.headers.get("x-admin-msg") || "").trim();
    const sig58 = String(req.headers.get("x-admin-sig") || "").trim();

    if (!wallet) return bad("missing_admin_wallet");
    if (!msg) return bad("missing_admin_msg");
    if (!sig58) return bad("missing_admin_sig");

    const admins = parseAdminWallets();
    if (!admins.length) return bad("admin_list_empty");
    if (!admins.includes(wallet)) return bad("not_admin");

    // msg 结构：WAOC_ONE_MISSION_ADMIN|wallet=...|nonce=...|ts=...
    if (!msg.startsWith("WAOC_ONE_MISSION_ADMIN|")) return bad("bad_admin_msg_prefix");
    if (!msg.includes(`wallet=${wallet}`)) return bad("admin_msg_wallet_mismatch");

    const parts = msg.split("|").slice(1);
    const map: Record<string, string> = {};
    for (const p of parts) {
      const idx = p.indexOf("=");
      if (idx > 0) map[p.slice(0, idx)] = p.slice(idx + 1);
    }

    const nonce = String(map.nonce || "").trim();
    const ts = Number(map.ts || 0);

    if (!nonce) return bad("missing_nonce");
    if (!Number.isFinite(ts) || ts <= 0) return bad("bad_ts");

    const now = Date.now();
    const maxAge = ttlSec() * 1000;

    // 防止未来时间/重放
    if (ts > now + 60_000) return bad("ts_in_future");
    if (now - ts > maxAge) return bad("sig_expired");

    const sig = bs58.decode(sig58);
    const pubkey = bs58.decode(wallet);
    const data = new TextEncoder().encode(msg);

    const ok = nacl.sign.detached.verify(data, sig, pubkey);
    if (!ok) return bad("bad_signature");

    return { ok: true, wallet, msg, ts, nonce };
  } catch (e: any) {
    return { ok: false, error: e?.message || "verify_admin_sig_error" };
  }
}
