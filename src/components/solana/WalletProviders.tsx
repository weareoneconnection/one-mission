"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";

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

export default function WalletProviders({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => {
    return (
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      "https://api.mainnet-beta.solana.com"
    );
  }, []);

  const wallets = useMemo(() => {
    const list = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
    // ✅ 防止重复 key（包括你遇到的 MetaMask）
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
