"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";

import "@solana/wallet-adapter-react-ui/styles.css";

function dedupeWalletsByName(list: any[]) {
  const seen = new Set<string>();
  return list.filter((w) => {
    const name = String(w?.name ?? "");
    if (!name) return true;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

function pickEndpoint() {
  const a = String(process.env.NEXT_PUBLIC_SOLANA_RPC || "").trim();
  const b = String(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "").trim();
  const c = String(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "").trim(); // 你原本用的同名也保留（兼容）
  return a || b || c || "https://api.mainnet-beta.solana.com";
}

export default function WalletProviders({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => pickEndpoint(), []);

  const wallets = useMemo(() => {
    const list = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
    return dedupeWalletsByName(list);
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
