"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Address, WalletClient } from "viem";
import {
  autoConnectMiniPay,
  buildInjectedWalletClient,
  connectMiniPay,
  fundAgentWithUsdc,
  isMiniPayRuntime,
} from "../../lib/minipay/connect";

type WalletState = {
  address: Address | null;
  isMiniPay: boolean;
  connecting: boolean;
  error: string | null;
};

export function useMiniPayWallet() {
  const clientRef = useRef<WalletClient | null>(null);
  const autoConnectStarted = useRef(false);
  const userDisconnectedRef = useRef(false);
  const [state, setState] = useState<WalletState>({
    address: null,
    isMiniPay: false,
    connecting: false,
    error: null,
  });

  const applyConnected = useCallback(
    (address: Address, isMiniPay: boolean, client: WalletClient) => {
      clientRef.current = client;
      setState({
        address,
        isMiniPay,
        connecting: false,
        error: null,
      });
    },
    [],
  );

  const connect = useCallback(async () => {
    userDisconnectedRef.current = false;
    setState((s) => ({ ...s, connecting: true, error: null }));
    try {
      const { address, isMiniPay, client } = await connectMiniPay();
      applyConnected(address, isMiniPay, client);
      return address;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Wallet connect failed";
      setState((s) => ({
        ...s,
        connecting: false,
        error: msg,
      }));
      return null;
    }
  }, [applyConnected]);

  /** Inside MiniPay: auto-connect on load (silent eth_accounts, then request if needed). */
  useEffect(() => {
    if (!isMiniPayRuntime() || autoConnectStarted.current) return;
    autoConnectStarted.current = true;

    setState((s) => ({ ...s, isMiniPay: true, connecting: true }));

    void (async () => {
      try {
        const result = await autoConnectMiniPay();
        if (result) {
          applyConnected(result.address, result.isMiniPay, result.client);
          return;
        }
        setState((s) => ({
          ...s,
          isMiniPay: true,
          connecting: false,
          error: null,
        }));
      } catch (e) {
        setState((s) => ({
          ...s,
          isMiniPay: true,
          connecting: false,
          error: e instanceof Error ? e.message : "MiniPay connect failed",
        }));
      }
    })();
  }, [applyConnected]);

  useEffect(() => {
    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (!eth?.on) return;
    const onAccounts = (accounts: unknown) => {
      if (userDisconnectedRef.current && !isMiniPayRuntime()) return;
      const list = Array.isArray(accounts) ? (accounts as string[]) : [];
      const next = (list[0] as Address | undefined) ?? null;
      if (next) {
        try {
          clientRef.current = buildInjectedWalletClient(next);
        } catch {
          clientRef.current = null;
        }
      } else {
        clientRef.current = null;
      }
      setState((s) => ({
        ...s,
        address: next,
        isMiniPay: isMiniPayRuntime() || s.isMiniPay,
      }));
    };
    eth.on("accountsChanged", onAccounts);
    return () => eth.removeListener?.("accountsChanged", onAccounts);
  }, []);

  const getWalletClient = useCallback(async (): Promise<{
    client: WalletClient;
    account: Address;
  } | null> => {
    const account = state.address;
    if (!account) return null;
    let client = clientRef.current;
    if (!client) {
      const connected = await connectMiniPay();
      clientRef.current = connected.client;
      client = connected.client;
    }
    return { client, account };
  }, [state.address]);

  const fundAgent = useCallback(
    async (agentAddress: Address, amountBaseUnits: bigint) => {
      const connected = await getWalletClient();
      if (!connected) {
        throw new Error("Connect your wallet first");
      }
      return fundAgentWithUsdc({
        client: connected.client,
        account: connected.account,
        agentAddress,
        amountBaseUnits,
      });
    },
    [getWalletClient],
  );

  const disconnect = useCallback(async () => {
    userDisconnectedRef.current = true;
    clientRef.current = null;

    const eth = typeof window !== "undefined" ? window.ethereum : undefined;
    if (eth?.request && !isMiniPayRuntime()) {
      try {
        await eth.request({
          method: "wallet_revokePermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch {
        // Local disconnect still applies if the wallet lacks revoke support.
      }
    }

    setState((s) => ({
      ...s,
      address: null,
      connecting: false,
      error: null,
    }));
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    fundAgent,
    getWalletClient,
  };
}
