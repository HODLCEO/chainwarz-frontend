import React, { useEffect, useMemo, useState } from "react";
import { Crown, ExternalLink, Shield, Swords, Wallet } from "lucide-react";
import sdk from "@farcaster/miniapp-sdk";

// Backend URL (Vercel env var VITE_BACKEND_URL is preferred)
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  "https://chainwarz-backend-production.up.railway.app";

// Simple host detection (good enough for UI toggles)
const isInIframe =
  typeof window !== "undefined" &&
  (window.parent !== window || window.location !== window.parent.location);

const CHAINS = {
  base: {
    key: "base",
    chainIdHex: "0x2105", // 8453
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    contractAddress: "0xB2B23e69b9d811D3D43AD473f90A171D18b19aab",
    strikeLabel: "0.000001337 ETH",
    // 0.000001337 ETH = 1,337,000,000,000 wei
    valueWei: 1337000000000n,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  },
  hyperevm: {
    key: "hyperevm",
    chainIdHex: "0xd0d4", // keep your existing chain id as used in-app
    name: "HyperEVM",
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    blockExplorer: "https://hyperevmscan.io",
    // UPDATED per your message:
    contractAddress: "0x044A0B2D6eF67F5B82e51ec7229D84C0e83C8f02",
    strikeLabel: "0.0001337 HYPE",
    // 0.0001337 with 18 decimals = 133,700,000,000,000 wei
    valueWei: 133700000000000n,
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  },
};

const RANKS = [
  { name: "Squire", min: 0, className: "text-gray-300" },
  { name: "Knight", min: 1, className: "text-blue-300" },
  { name: "Knight Captain", min: 5, className: "text-purple-300" },
  { name: "Baron", min: 10, className: "text-yellow-300" },
  { name: "Duke", min: 25, className: "text-orange-300" },
  { name: "Warlord", min: 50, className: "text-red-300" },
  { name: "Legendary Champion", min: 100, className: "text-pink-300" },
];

function getRank(totalStrikes) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (totalStrikes >= RANKS[i].min) return RANKS[i];
  }
  return RANKS[0];
}

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("game");

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  const [account, setAccount] = useState(null);
  const [connectedVia, setConnectedVia] = useState(null); // "farcaster" | "browser"
  const [currentChainId, setCurrentChainId] = useState(null);

  const [profile, setProfile] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });

  const [lastTx, setLastTx] = useState(null); // { chainKey, hash }

  // Provider references (not in state to avoid rerenders)
  const [fcProvider, setFcProvider] = useState(null);
  const [browserProvider, setBrowserProvider] = useState(null);

  const totalStrikes = useMemo(() => {
    if (!profile?.txCount) return 0;
    return (profile.txCount.base || 0) + (profile.txCount.hyperevm || 0);
  }, [profile]);

  const currentRank = useMemo(() => getRank(totalStrikes), [totalStrikes]);

  // -------------- Startup: init SDK + providers + initial fetches --------------
  useEffect(() => {
    const init = async () => {
      // 1) Always try to call ready() when in iframe (Farcaster host)
      try {
        if (isInIframe) {
          // accessing sdk.context helps ensure the SDK is actually alive
          await sdk.context;
          await sdk.actions.ready();
        }
      } catch {
        // If ready fails, don't brick the app — continue.
      }

      // 2) Capture injected browser provider if present
      if (typeof window !== "undefined" && window.ethereum) {
        setBrowserProvider(window.ethereum);
      }

      // 3) Try to get Farcaster provider if host supports it
      try {
        const caps = await sdk.getCapabilities();
        const supportsFcProvider = caps.includes("wallet.getEthereumProvider");
        if (supportsFcProvider) {
          const p = await sdk.wallet.getEthereumProvider();
          if (p) setFcProvider(p);
        }
      } catch {
        // ignore
      }

      // 4) Load leaderboards immediately (works without wallet)
      await loadLeaderboards();
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------- Backend calls --------------
  const loadProfile = async (addr) => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/profile/${addr}`);
      const data = await r.json();
      setProfile(data);
    } catch {
      // fallback (never show raw errors to users)
      setProfile({
        username: `knight_${addr.slice(2, 8)}`,
        displayName: "Castle Warrior",
        bio: "Defending the realm in the multi-chain wars",
        pfpUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${addr}`,
        fid: null,
        txCount: { base: 0, hyperevm: 0 },
      });
    }
  };

  const loadLeaderboards = async () => {
    try {
      const [b, h] = await Promise.all([
        fetch(`${BACKEND_URL}/api/leaderboard/base`).then((r) => r.json()),
        fetch(`${BACKEND_URL}/api/leaderboard/hyperevm`).then((r) => r.json()),
      ]);
      setLeaderboard({ base: b, hyperevm: h });
    } catch {
      // If backend is down, just show empty lists
      setLeaderboard({ base: [], hyperevm: [] });
    }
  };

  // -------------- Helpers for provider / chain / tx --------------
  const getActiveProvider = () => {
    // If user explicitly connected via one method, honor it
    if (connectedVia === "farcaster" && fcProvider) return fcProvider;
    if (connectedVia === "browser" && browserProvider) return browserProvider;

    // Otherwise prefer Farcaster provider when inside host
    if (isInIframe && fcProvider) return fcProvider;

    // Fallback to injected wallet
    return browserProvider || null;
  };

  const refreshChainId = async () => {
    const p = getActiveProvider();
    if (!p?.request) return;
    try {
      const cid = await p.request({ method: "eth_chainId" });
      setCurrentChainId(cid);
    } catch {
      // ignore
    }
  };

  const requestAccounts = async (provider, viaLabel) => {
    if (!provider?.request) {
      setStatus("No wallet provider found.");
      return null;
    }

    try {
      setLoading(true);
      setStatus(viaLabel === "farcaster" ? "Connecting Farcaster wallet…" : "Connecting wallet…");

      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const addr = accounts?.[0];
      if (!addr) {
        setStatus("No account returned.");
        return null;
      }

      setAccount(addr);
      setConnectedVia(viaLabel);
      setStatus("Connected.");

      // Keep chain + profile synced
      await refreshChainId();
      await loadProfile(addr);

      // Subscribe to changes (if supported)
      if (provider.on) {
        provider.on("accountsChanged", (accs) => {
          const a = accs?.[0] || null;
          setAccount(a);
          if (a) loadProfile(a);
          else setProfile(null);
        });
        provider.on("chainChanged", () => refreshChainId());
      }

      return addr;
    } catch {
      setStatus("Connection cancelled.");
      return null;
    } finally {
      setLoading(false);
    }
  };

  const switchChain = async (chainKey) => {
    const chain = CHAINS[chainKey];
    const p = getActiveProvider();
    if (!p?.request) throw new Error("No provider");

    try {
      setStatus(`Traveling to ${chain.name}…`);
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chain.chainIdHex }],
      });
    } catch (err) {
      // 4902 = unknown chain => add it
      if (err?.code === 4902) {
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: chain.chainIdHex,
              chainName: chain.name,
              rpcUrls: [chain.rpcUrl],
              blockExplorerUrls: [chain.blockExplorer],
              nativeCurrency: chain.nativeCurrency,
            },
          ],
        });
      } else {
        throw err;
      }
    }

    await refreshChainId();
  };

  const sendStrike = async (chainKey) => {
    const chain = CHAINS[chainKey];
    const p = getActiveProvider();

    if (!account) {
      setStatus("Connect a wallet first.");
      return;
    }
    if (!p?.request) {
      setStatus("No wallet provider available.");
      return;
    }

    try {
      setLoading(true);
      setStatus(`Preparing strike on ${chain.name}…`);

      await switchChain(chainKey);

      // Convert bigint wei to hex for tx value
      const valueHex = "0x" + chain.valueWei.toString(16);

      setStatus("Confirm the transaction in your wallet…");
      const hash = await p.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: chain.contractAddress,
            value: valueHex,
            data: "0x",
          },
        ],
      });

      setLastTx({ chainKey, hash });
      setStatus("Strike sent!");

      // Refresh leaderboards + your profile after a short delay
      setTimeout(() => {
        loadLeaderboards();
        loadProfile(account);
      }, 2500);
    } catch {
      setStatus("Transaction cancelled or failed.");
    } finally {
      setLoading(false);
    }
  };

  // -------------- UI --------------
  const explorerTxUrl = (tx) => {
    if (!tx?.hash) return "#";
    const chain = CHAINS[tx.chainKey];
    return `${chain.blockExplorer}/tx/${tx.hash}`;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-md mx-auto p-4">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <Shield className="text-gray-300" />
            <h1 className="text-3xl font-extrabold tracking-tight">ChainWarZ</h1>
          </div>
          <p className="text-gray-300 mt-2">Strike chains. Climb ranks. Dominate.</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveTab("game")}
            className={`flex-1 rounded-lg px-3 py-2 font-bold flex items-center justify-center gap-2 border ${
              activeTab === "game" ? "bg-gray-900 border-gray-700" : "bg-black border-gray-900 text-gray-300"
            }`}
          >
            <Swords size={18} /> Game
          </button>
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex-1 rounded-lg px-3 py-2 font-bold flex items-center justify-center gap-2 border ${
              activeTab === "profile" ? "bg-gray-900 border-gray-700" : "bg-black border-gray-900 text-gray-300"
            }`}
          >
            <Shield size={18} /> Profile
          </button>
          <button
            onClick={() => setActiveTab("leaderboard")}
            className={`flex-1 rounded-lg px-3 py-2 font-bold flex items-center justify-center gap-2 border ${
              activeTab === "leaderboard" ? "bg-gray-900 border-gray-700" : "bg-black border-gray-900 text-gray-300"
            }`}
          >
            <Crown size={18} /> Leaderboard
          </button>
        </div>

        {/* Status (user-friendly only) */}
        {status ? (
          <div className="mb-4 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200">
            {status}
          </div>
        ) : null}

        {/* GAME TAB */}
        {activeTab === "game" && (
          <div className="space-y-4">
            {/* Wallet box */}
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-400">Wallet</div>
                  <div className="font-bold">{account ? shortAddr(account) : "Not connected"}</div>
                  {currentChainId ? (
                    <div className="text-xs text-gray-400 mt-1">Chain: {currentChainId}</div>
                  ) : null}
                </div>
                <Wallet className="text-gray-300" />
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => requestAccounts(fcProvider, "farcaster")}
                  disabled={!fcProvider || loading}
                  className={`flex-1 rounded-lg px-3 py-2 font-bold border ${
                    fcProvider ? "border-gray-700 bg-gray-900" : "border-gray-900 bg-black text-gray-600"
                  }`}
                  title={fcProvider ? "" : "Farcaster provider not available in this host"}
                >
                  Connect Farcaster
                </button>

                <button
                  onClick={() => requestAccounts(browserProvider, "browser")}
                  disabled={!browserProvider || loading}
                  className={`flex-1 rounded-lg px-3 py-2 font-bold border ${
                    browserProvider ? "border-gray-700 bg-gray-900" : "border-gray-900 bg-black text-gray-600"
                  }`}
                  title={browserProvider ? "" : "No injected wallet found (MetaMask/Rabby)"}
                >
                  Connect Browser
                </button>
              </div>

              {connectedVia ? (
                <div className="mt-2 text-xs text-gray-400">Connected via: {connectedVia}</div>
              ) : null}
            </div>

            {/* Strike buttons */}
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <div className="font-bold mb-3">Strike</div>

              <button
                onClick={() => sendStrike("base")}
                disabled={!account || loading}
                className="w-full rounded-xl border border-blue-700 bg-blue-950 px-4 py-3 font-extrabold mb-3 disabled:opacity-50"
              >
                Base — {CHAINS.base.strikeLabel}
              </button>

              <button
                onClick={() => sendStrike("hyperevm")}
                disabled={!account || loading}
                className="w-full rounded-xl border border-green-700 bg-green-950 px-4 py-3 font-extrabold disabled:opacity-50"
              >
                HyperEVM — {CHAINS.hyperevm.strikeLabel}
              </button>

              {lastTx?.hash ? (
                <a
                  href={explorerTxUrl(lastTx)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-2 text-sm text-gray-200 underline"
                >
                  View last tx <ExternalLink size={16} />
                </a>
              ) : null}
            </div>
          </div>
        )}

        {/* PROFILE TAB */}
        {activeTab === "profile" && (
          <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
            {!account ? (
              <div className="text-gray-300">
                Connect a wallet to see your profile.
              </div>
            ) : !profile ? (
              <div className="text-gray-300">Loading profile…</div>
            ) : (
              <div className="flex gap-3">
                <img
                  src={profile.pfpUrl}
                  alt="pfp"
                  className="w-14 h-14 rounded-full border border-gray-700"
                />
                <div className="flex-1 min-w-0">
                  <div className={`font-extrabold ${currentRank.className}`}>
                    {currentRank.name}
                  </div>
                  <div className="font-bold truncate">
                    {profile.displayName || profile.username || shortAddr(account)}
                  </div>
                  {profile.username ? (
                    <div className="text-sm text-gray-400 truncate">@{profile.username}</div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-gray-800 bg-black px-3 py-2">
                      <div className="text-xs text-gray-400">Base strikes</div>
                      <div className="font-extrabold">{profile.txCount?.base || 0}</div>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-black px-3 py-2">
                      <div className="text-xs text-gray-400">HyperEVM strikes</div>
                      <div className="font-extrabold">{profile.txCount?.hyperevm || 0}</div>
                    </div>
                  </div>

                  {profile.bio ? (
                    <div className="mt-3 text-sm text-gray-300">{profile.bio}</div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        {/* LEADERBOARD TAB */}
        {activeTab === "leaderboard" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-extrabold">Base Leaderboard</div>
                <button
                  className="text-sm underline text-gray-300"
                  onClick={loadLeaderboards}
                  disabled={loading}
                >
                  Refresh
                </button>
              </div>

              {leaderboard.base?.length ? (
                <div className="space-y-2">
                  {leaderboard.base.slice(0, 10).map((p) => (
                    <div
                      key={`b-${p.address}`}
                      className="flex items-center gap-3 rounded-lg border border-gray-800 bg-black px-3 py-2"
                    >
                      <div className="w-6 text-center font-extrabold text-gray-300">
                        {p.rank}
                      </div>
                      <img
                        src={p.pfpUrl}
                        alt=""
                        className="w-8 h-8 rounded-full border border-gray-700"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate text-gray-200">
                          {p.username || shortAddr(p.address)}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {shortAddr(p.address)}
                        </div>
                      </div>
                      <div className="font-extrabold text-blue-300">{p.txCount}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-400 text-sm">No data yet.</div>
              )}
            </div>

            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <div className="font-extrabold mb-3">HyperEVM Leaderboard</div>

              {leaderboard.hyperevm?.length ? (
                <div className="space-y-2">
                  {leaderboard.hyperevm.slice(0, 10).map((p) => (
                    <div
                      key={`h-${p.address}`}
                      className="flex items-center gap-3 rounded-lg border border-gray-800 bg-black px-3 py-2"
                    >
                      <div className="w-6 text-center font-extrabold text-gray-300">
                        {p.rank}
                      </div>
                      <img
                        src={p.pfpUrl}
                        alt=""
                        className="w-8 h-8 rounded-full border border-gray-700"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate text-gray-200">
                          {p.username || shortAddr(p.address)}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {shortAddr(p.address)}
                        </div>
                      </div>
                      <div className="font-extrabold text-green-300">{p.txCount}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-400 text-sm">No data yet.</div>
              )}
            </div>
          </div>
        )}

        {/* tiny footer */}
        <div className="mt-6 text-center text-xs text-gray-600">
          {isInIframe ? "Running inside host" : "Running in browser"}
        </div>
      </div>
    </div>
  );
}
