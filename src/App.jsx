import React, { useEffect, useMemo, useState } from "react";
import { Wallet, ExternalLink, Shield, Swords, Crown } from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "https://chainwarz-backend-production.up.railway.app";

const CHAINS = {
  base: {
    key: "base",
    chainIdHex: "0x2105", // 8453
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    contractAddress: "0xB2B23e69b9d811D3D43AD473f90A171D18b19aab",
    // ✅ EXACT: 0.000001337 ETH
    valueWei: 1337000000000n, // hex: 0x1374b68fa00
    strikeLabel: "0.000001337 ETH",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  },
  hyperevm: {
    key: "hyperevm",
    chainIdHex: "0x3e7", // 999
    name: "HyperEVM",
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    blockExplorer: "https://hyperevmscan.io",
    contractAddress: "0x044A0B2D6eF67F5B82e51ec7229D84C0e83C8f02",
    valueWei: 133700000000000n, // 0.0001337 HYPE
    strikeLabel: "0.0001337 HYPE",
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
  for (let i = RANKS.length - 1; i >= 0; i--) if (totalStrikes >= RANKS[i].min) return RANKS[i];
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

  const [inMiniApp, setInMiniApp] = useState(false);

  // Providers
  const [fcProvider, setFcProvider] = useState(null);
  const [browserProvider, setBrowserProvider] = useState(null);
  const [connectedVia, setConnectedVia] = useState(null); // "farcaster" | "browser"

  // Wallet state
  const [account, setAccount] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [lastTx, setLastTx] = useState(null);

  // Farcaster context user
  const [fcUser, setFcUser] = useState(null);

  // Data
  const [profileCounts, setProfileCounts] = useState({ base: 0, hyperevm: 0 });
  const [profileIdentity, setProfileIdentity] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });

  const totalStrikes = (profileCounts.base || 0) + (profileCounts.hyperevm || 0);
  const currentRank = useMemo(() => getRank(totalStrikes), [totalStrikes]);

  const getActiveProvider = () => {
    if (connectedVia === "farcaster" && fcProvider) return fcProvider;
    if (connectedVia === "browser" && browserProvider) return browserProvider;
    if (fcProvider) return fcProvider;
    return browserProvider || null;
  };

  const refreshChainId = async () => {
    const p = getActiveProvider();
    if (!p?.request) return;
    try {
      const cid = await p.request({ method: "eth_chainId" });
      setCurrentChainId(cid);
    } catch {}
  };

  const loadLeaderboards = async () => {
    try {
      const [b, h] = await Promise.all([
        fetch(`${BACKEND_URL}/api/leaderboard/base`).then((r) => r.json()),
        fetch(`${BACKEND_URL}/api/leaderboard/hyperevm`).then((r) => r.json()),
      ]);
      setLeaderboard({
        base: Array.isArray(b) ? b : [],
        hyperevm: Array.isArray(h) ? h : [],
      });
    } catch {
      setLeaderboard({ base: [], hyperevm: [] });
    }
  };

  // ✅ New: load merged counts by FID (when inside Farcaster host)
  const loadCountsForFid = async (fid) => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/profile/fid/${fid}`);
      const data = await r.json();
      setProfileCounts({
        base: data?.txCount?.base || 0,
        hyperevm: data?.txCount?.hyperevm || 0,
      });
      if (data?.user) setProfileIdentity(data.user);
    } catch {
      setProfileCounts({ base: 0, hyperevm: 0 });
    }
  };

  const loadCountsForAddress = async (addr) => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/profile/${addr}`);
      const data = await r.json();
      setProfileCounts({
        base: data?.txCount?.base || 0,
        hyperevm: data?.txCount?.hyperevm || 0,
      });
    } catch {
      setProfileCounts({ base: 0, hyperevm: 0 });
    }
  };

  const loadFarcasterIdentityByFid = async (fid) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/farcaster/user/${fid}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // INIT
  useEffect(() => {
    const init = async () => {
      // Browser wallet
      if (typeof window !== "undefined" && window.ethereum) setBrowserProvider(window.ethereum);

      // Miniapp context + Farcaster provider
      try {
        const mini = await sdk.isInMiniApp();
        setInMiniApp(!!mini);

        if (mini) {
          const ctx = await sdk.context; // ✅ this is the key: actually use the returned context
          setFcUser(ctx?.user || null);

          await sdk.actions.ready();

          const caps = await sdk.getCapabilities();
          if (caps.includes("wallet.getEthereumProvider")) {
            const p = await sdk.wallet.getEthereumProvider();
            if (p) setFcProvider(p);
          }

          // ✅ Immediately hydrate identity & merged counts via FID
          if (ctx?.user?.fid) {
            const ident = await loadFarcasterIdentityByFid(ctx.user.fid);
            if (ident) setProfileIdentity(ident);
            await loadCountsForFid(ctx.user.fid);
          }
        }
      } catch {}

      loadLeaderboards();
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When account changes:
  // - If in MiniApp and we have fid → always show merged-by-fid counts
  // - Else → address-only counts
  useEffect(() => {
    const run = async () => {
      if (inMiniApp && fcUser?.fid) {
        const ident = await loadFarcasterIdentityByFid(fcUser.fid);
        if (ident) setProfileIdentity(ident);
        await loadCountsForFid(fcUser.fid);
      } else if (account) {
        await loadCountsForAddress(account);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, inMiniApp, fcUser?.fid]);

  const requestAccounts = async (provider, viaLabel) => {
    if (!provider?.request) {
      setStatus("No wallet provider found.");
      return null;
    }

    try {
      setLoading(true);
      setStatus(viaLabel === "farcaster" ? "Connecting Farcaster wallet…" : "Connecting browser wallet…");

      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const addr = accounts?.[0];
      if (!addr) {
        setStatus("No account returned.");
        return null;
      }

      setAccount(addr);
      setConnectedVia(viaLabel);
      setStatus("Connected.");

      await refreshChainId();

      // ✅ If in host, prefer fid-based merge totals + identity
      if (inMiniApp && fcUser?.fid) {
        const ident = await loadFarcasterIdentityByFid(fcUser.fid);
        if (ident) setProfileIdentity(ident);
        await loadCountsForFid(fcUser.fid);
      } else {
        await loadCountsForAddress(addr);
      }

      if (provider.on) {
        provider.on("accountsChanged", (accs) => {
          const a = accs?.[0] || null;
          setAccount(a);
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

  const switchOrAddChain = async (chainKey) => {
    const chain = CHAINS[chainKey];
    const p = getActiveProvider();
    if (!p?.request) throw new Error("No provider");

    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chain.chainIdHex }] });
    } catch (err) {
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

    if (!account) return setStatus("Connect a wallet first.");
    if (!p?.request) return setStatus("No wallet provider available.");

    try {
      setLoading(true);
      setStatus(`Preparing strike on ${chain.name}…`);

      await switchOrAddChain(chainKey);

      const valueHex = "0x" + chain.valueWei.toString(16);

      setStatus("Confirm the transaction in your wallet…");
      const hash = await p.request({
        method: "eth_sendTransaction",
        params: [{ from: account, to: chain.contractAddress, value: valueHex, data: "0x" }],
      });

      setLastTx({ chainKey, hash });
      setStatus("Strike sent!");

      setTimeout(() => {
        loadLeaderboards();
        if (inMiniApp && fcUser?.fid) loadCountsForFid(fcUser.fid);
        else if (account) loadCountsForAddress(account);
      }, 2500);
    } catch {
      setStatus("Transaction cancelled or failed.");
    } finally {
      setLoading(false);
    }
  };

  const explorerTxUrl = () => {
    if (!lastTx?.hash) return "#";
    const chain = CHAINS[lastTx.chainKey];
    return `${chain.blockExplorer}/tx/${lastTx.hash}`;
  };

  // Identity display priority:
  // 1) backend (by fid)
  // 2) fc context user
  // 3) fallback
  const displayName =
    profileIdentity?.displayName ||
    profileIdentity?.display_name ||
    fcUser?.displayName ||
    fcUser?.username ||
    (account ? shortAddr(account) : "Unknown");

  const username =
    (profileIdentity?.username ? `@${profileIdentity.username}` : "") ||
    (fcUser?.username ? `@${fcUser.username}` : "");

  const pfpUrl =
    profileIdentity?.pfpUrl ||
    profileIdentity?.pfp_url ||
    fcUser?.pfpUrl ||
    (account ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${account}` : "");

  const bio =
    profileIdentity?.bio ||
    profileIdentity?.profile?.bio?.text ||
    "";

  // Use farcaster.xyz link (works even if names/domains change, and avoids “warpcast is gone” drama)
  const profileUrl =
    profileIdentity?.farcasterUrl ||
    (profileIdentity?.username ? `https://farcaster.xyz/${profileIdentity.username}` : null) ||
    (fcUser?.username ? `https://farcaster.xyz/${fcUser.username}` : null);

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-md mx-auto p-4">
        <div className="mb-4">
          <div className="flex items-center gap-3">
            <Shield className="text-gray-300" />
            <h1 className="text-3xl font-extrabold tracking-tight">ChainWarZ</h1>
          </div>
          <p className="text-gray-300 mt-2">Strike chains. Climb ranks. Dominate.</p>
        </div>

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

        {status ? (
          <div className="mb-4 rounded-lg border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-200">
            {status}
          </div>
        ) : null}

        {activeTab === "game" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-gray-400">Wallet</div>
                  <div className="font-bold">{account ? shortAddr(account) : "Not connected"}</div>
                  {currentChainId ? <div className="text-xs text-gray-400 mt-1">Chain: {currentChainId}</div> : null}
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
                >
                  Connect Farcaster
                </button>

                <button
                  onClick={() => requestAccounts(browserProvider, "browser")}
                  disabled={!browserProvider || loading}
                  className={`flex-1 rounded-lg px-3 py-2 font-bold border ${
                    browserProvider ? "border-gray-700 bg-gray-900" : "border-gray-900 bg-black text-gray-600"
                  }`}
                >
                  Connect Browser
                </button>
              </div>

              {connectedVia ? <div className="mt-2 text-xs text-gray-400">Connected via: {connectedVia}</div> : null}
            </div>

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
                  href={explorerTxUrl()}
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

        {activeTab === "profile" && (
          <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
            {!account ? (
              <div className="text-gray-300">Connect a wallet to see your strike counts.</div>
            ) : (
              <div className="flex gap-3">
                <img
                  src={pfpUrl}
                  alt="pfp"
                  className="w-14 h-14 rounded-full border border-gray-700 object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className={`font-extrabold ${currentRank.className}`}>{currentRank.name}</div>
                  <div className="font-bold truncate">{displayName}</div>
                  {username ? <div className="text-sm text-gray-400 truncate">{username}</div> : null}
                  {bio ? <div className="mt-2 text-sm text-gray-300">{bio}</div> : null}

                  {profileUrl ? (
                    <a
                      href={profileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-2 text-sm text-gray-200 underline"
                    >
                      View on Farcaster <ExternalLink size={16} />
                    </a>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg border border-gray-800 bg-black px-3 py-2">
                      <div className="text-xs text-gray-400">Base strikes</div>
                      <div className="font-extrabold">{profileCounts.base}</div>
                    </div>
                    <div className="rounded-lg border border-gray-800 bg-black px-3 py-2">
                      <div className="text-xs text-gray-400">HyperEVM strikes</div>
                      <div className="font-extrabold">{profileCounts.hyperevm}</div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-gray-600">Running inside host</div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-gray-800 bg-gray-950 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-extrabold">Base Leaderboard</div>
                <button className="text-sm underline text-gray-300" onClick={loadLeaderboards} disabled={loading}>
                  Refresh
                </button>
              </div>

              {leaderboard.base?.length ? (
                <div className="space-y-2">
                  {leaderboard.base.slice(0, 10).map((p) => (
                    <div
                      key={`b-${p.fid || p.address || p.rank}`}
                      className="flex items-center gap-3 rounded-lg border border-gray-800 bg-black px-3 py-2"
                    >
                      <div className="w-10 text-center font-extrabold text-gray-300">#{p.rank}</div>
                      {p.pfpUrl ? (
                        <img src={p.pfpUrl} alt="" className="w-8 h-8 rounded-full border border-gray-700" />
                      ) : (
                        <div className="w-8 h-8 rounded-full border border-gray-700" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate text-gray-200">
                          {p.username ? p.username : p.address ? shortAddr(p.address) : "Unknown"}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {p.walletCount > 1 ? `${p.walletCount} wallets merged` : "1 wallet"}
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
              <div className="flex items-center justify-between mb-3">
                <div className="font-extrabold">HyperEVM Leaderboard</div>
                <button className="text-sm underline text-gray-300" onClick={loadLeaderboards} disabled={loading}>
                  Refresh
                </button>
              </div>

              {leaderboard.hyperevm?.length ? (
                <div className="space-y-2">
                  {leaderboard.hyperevm.slice(0, 10).map((p) => (
                    <div
                      key={`h-${p.fid || p.address || p.rank}`}
                      className="flex items-center gap-3 rounded-lg border border-gray-800 bg-black px-3 py-2"
                    >
                      <div className="w-10 text-center font-extrabold text-gray-300">#{p.rank}</div>
                      {p.pfpUrl ? (
                        <img src={p.pfpUrl} alt="" className="w-8 h-8 rounded-full border border-gray-700" />
                      ) : (
                        <div className="w-8 h-8 rounded-full border border-gray-700" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate text-gray-200">
                          {p.username ? p.username : p.address ? shortAddr(p.address) : "Unknown"}
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {p.walletCount > 1 ? `${p.walletCount} wallets merged` : "1 wallet"}
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
      </div>
    </div>
  );
}
