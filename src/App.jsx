import React, { useEffect, useMemo, useState } from "react";
import { Wallet, ExternalLink, Shield, Swords, Crown } from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  "https://chainwarz-backend-production.up.railway.app";

const CHAINS = {
  base: {
    key: "base",
    chainIdHex: "0x2105",
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    contractAddress: "0xB2B23e69b9d811D3D43AD473f90A171D18b19aab",
    // ✅ user requested base strike should be 0.000001337
    valueWei: 1337000000000n, // 0.000001337 ETH
    strikeLabel: "0.000001337 ETH",
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  },
  hyperevm: {
    key: "hyperevm",
    chainIdHex: "0x3e7",
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

  // Providers
  const [fcProvider, setFcProvider] = useState(null);
  const [browserProvider, setBrowserProvider] = useState(null);
  const [connectedVia, setConnectedVia] = useState(null); // "farcaster" | "browser"

  // Wallet state
  const [account, setAccount] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);
  const [lastTx, setLastTx] = useState(null); // { chainKey, hash }

  // Farcaster context user (fid/username/etc)
  const [fcUser, setFcUser] = useState(null);
  const [isInHost, setIsInHost] = useState(false);

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

  // ✅ BEST: real Farcaster profile comes from FID (not from wallet address)
  const loadFarcasterIdentityByFid = async (fid) => {
    if (!fid) return null;
    try {
      const res = await fetch(`${BACKEND_URL}/api/farcaster/user/${fid}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  // Init
  useEffect(() => {
    const init = async () => {
      // Browser wallet provider
      if (typeof window !== "undefined" && window.ethereum) {
        setBrowserProvider(window.ethereum);
      }

      // Miniapp context + Farcaster provider
      try {
        const mini = await sdk.isInMiniApp();
        setIsInHost(!!mini);

        if (mini) {
          // Important ordering: context -> capabilities -> provider -> ready
          const ctx = sdk.context;
          setFcUser(ctx?.user || null);

          const caps = await sdk.getCapabilities();
          if (caps.includes("wallet.getEthereumProvider")) {
            const p = await sdk.wallet.getEthereumProvider();
            if (p) setFcProvider(p);
          }

          await sdk.actions.ready();

          // If we have an fid, prefetch identity immediately
          const fid = ctx?.user?.fid;
          if (fid) {
            const ident = await loadFarcasterIdentityByFid(fid);
            if (ident) setProfileIdentity(ident);
          } else {
            // fallback: at least keep whatever context provides
            if (ctx?.user) setProfileIdentity(ctx.user);
          }
        }
      } catch {
        // ignore
      }

      loadLeaderboards();
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When profile tab opens, refresh identity again (in case it was slow)
  useEffect(() => {
    const run = async () => {
      if (activeTab !== "profile") return;
      const fid = fcUser?.fid;
      if (fid) {
        const ident = await loadFarcasterIdentityByFid(fid);
        if (ident) setProfileIdentity(ident);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fcUser?.fid]);

  // Connect
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
      await loadCountsForAddress(addr);

      // If in host, identity should come from fid, regardless of wallet address
      const fid = fcUser?.fid;
      if (fid) {
        const ident = await loadFarcasterIdentityByFid(fid);
        if (ident) setProfileIdentity(ident);
      }

      if (provider.on) {
        provider.on("accountsChanged", (accs) => {
          const a = accs?.[0] || null;
          setAccount(a);
          if (a) loadCountsForAddress(a);
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
      await p.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chain.chainIdHex }],
      });
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
        loadCountsForAddress(account);
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

  // Profile display (prefer backend by fid; fallback to sdk.context.user; fallback to address)
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
    fcUser?.bio ||
    "";

  const warpcastUrl =
    profileIdentity?.warpcastUrl ||
    (profileIdentity?.username ? `https://warpcast.com/${profileIdentity.username}` : null) ||
    (fcUser?.username ? `https://warpcast.com/${fcUser.username}` : null);

  // --- UI / styling ---
  return (
    <div className="min-h-screen text-white cw-root">
      <style>{castleCss}</style>

      <div className="max-w-md mx-auto p-4">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="cw-shieldBadge" aria-hidden>⛨</div>
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight">ChainWarZ</h1>
              <p className="text-gray-300 mt-1 text-sm">Strike chains. Climb ranks. Dominate.</p>
            </div>
          </div>

          <div className="text-right">
            {connectedVia ? (
              <div className="cw-chip">
                <span className="cw-dot" />
                Connected via <b className="ml-1">{connectedVia}</b>
              </div>
            ) : (
              <div className="cw-chip opacity-80">
                <span className="cw-dot cw-dot--off" />
                Not connected
              </div>
            )}
            {account ? <div className="mt-2 text-xs text-gray-300">{shortAddr(account)}</div> : null}
          </div>
        </div>

        <div className="cw-tabs mb-4">
          <button
            onClick={() => setActiveTab("game")}
            className={`cw-tab ${activeTab === "game" ? "cw-tab--active" : ""}`}
          >
            <Swords size={16} /> Game
          </button>
          <button
            onClick={() => setActiveTab("profile")}
            className={`cw-tab ${activeTab === "profile" ? "cw-tab--active" : ""}`}
          >
            <Shield size={16} /> Profile
          </button>
          <button
            onClick={() => setActiveTab("leaderboard")}
            className={`cw-tab ${activeTab === "leaderboard" ? "cw-tab--active" : ""}`}
          >
            <Crown size={16} /> Leaderboard
          </button>
        </div>

        {status ? <div className="cw-toast mb-4">{status}</div> : null}

        {activeTab === "game" && (
          <div className="space-y-4">
            <div className="cw-card p-4">
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
                  className={`cw-btn ${fcProvider ? "cw-btn--primary" : "cw-btn--disabled"}`}
                >
                  Connect Farcaster
                </button>

                <button
                  onClick={() => requestAccounts(browserProvider, "browser")}
                  disabled={!browserProvider || loading}
                  className={`cw-btn ${browserProvider ? "" : "cw-btn--disabled"}`}
                >
                  Connect Browser
                </button>
              </div>

              {isInHost && !fcProvider ? (
                <div className="mt-2 text-xs text-gray-400">
                  Host detected, but wallet provider capability not available in this host.
                </div>
              ) : null}
            </div>

            <div className="cw-card p-4">
              <div className="font-bold mb-3">Strike</div>

              <button
                onClick={() => sendStrike("base")}
                disabled={!account || loading}
                className="cw-strike cw-strike--base disabled:opacity-50"
              >
                <div>
                  <div className="cw-strike__h">Base</div>
                  <div className="cw-strike__s">{CHAINS.base.strikeLabel}</div>
                </div>
                <span className="cw-pill">Strike</span>
              </button>

              <button
                onClick={() => sendStrike("hyperevm")}
                disabled={!account || loading}
                className="cw-strike cw-strike--hyper disabled:opacity-50"
              >
                <div>
                  <div className="cw-strike__h">HyperEVM</div>
                  <div className="cw-strike__s">{CHAINS.hyperevm.strikeLabel}</div>
                </div>
                <span className="cw-pill">Strike</span>
              </button>

              {lastTx?.hash ? (
                <a href={explorerTxUrl()} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 text-sm text-gray-200 underline">
                  View last tx <ExternalLink size={16} />
                </a>
              ) : null}
            </div>
          </div>
        )}

        {activeTab === "profile" && (
          <div className="cw-card p-4">
            {!account ? (
              <div className="text-gray-300">Connect a wallet to see your strike counts.</div>
            ) : (
              <div className="flex gap-3">
                {/* ✅ smaller profile picture */}
                <img
                  src={pfpUrl}
                  alt="pfp"
                  className="w-14 h-14 rounded-2xl border border-white/10 object-cover"
                />
                <div className="flex-1 min-w-0">
                  <div className={`font-extrabold ${currentRank.className}`}>{currentRank.name}</div>
                  <div className="font-bold truncate">{displayName}</div>
                  {username ? <div className="text-sm text-gray-300/80 truncate">{username}</div> : null}
                  {bio ? <div className="mt-2 text-sm text-gray-200/90">{bio}</div> : null}

                  {warpcastUrl ? (
                    <a href={warpcastUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-2 text-sm text-yellow-200 underline">
                      View on Warpcast <ExternalLink size={16} />
                    </a>
                  ) : null}

                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="cw-mini">
                      <div className="text-xs text-gray-400">Base strikes</div>
                      <div className="text-xl font-extrabold">{profileCounts.base}</div>
                    </div>
                    <div className="cw-mini">
                      <div className="text-xs text-gray-400">HyperEVM strikes</div>
                      <div className="text-xl font-extrabold">{profileCounts.hyperevm}</div>
                    </div>
                  </div>

                  <div className="mt-3 text-xs text-gray-500">Built for Farcaster Mini Apps</div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-4">
            <div className="cw-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-extrabold">Base Leaderboard</div>
                <button className="text-sm underline text-yellow-200" onClick={loadLeaderboards} disabled={loading}>
                  Refresh
                </button>
              </div>

              {leaderboard.base?.length ? (
                <div className="space-y-2">
                  {leaderboard.base.slice(0, 10).map((p) => (
                    <div key={`b-${p.fid || p.address}`} className="cw-rowItem">
                      <div className="w-10 text-center font-extrabold text-gray-300">#{p.rank}</div>
                      <img src={p.pfpUrl} alt="" className="w-9 h-9 rounded-full border border-white/10" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate text-gray-100">{p.username || shortAddr(p.address)}</div>
                        <div className="text-xs text-gray-500 truncate">{p.fid ? `FID ${p.fid}` : shortAddr(p.address)}</div>
                      </div>
                      <div className="font-extrabold text-blue-200">{p.txCount}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-gray-400 text-sm">No data yet.</div>
              )}
            </div>

            <div className="cw-card p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-extrabold">HyperEVM Leaderboard</div>
                <button className="text-sm underline text-yellow-200" onClick={loadLeaderboards} disabled={loading}>
                  Refresh
                </button>
              </div>

              {leaderboard.hyperevm?.length ? (
                <div className="space-y-2">
                  {leaderboard.hyperevm.slice(0, 10).map((p) => (
                    <div key={`h-${p.fid || p.address}`} className="cw-rowItem">
                      <div className="w-10 text-center font-extrabold text-gray-300">#{p.rank}</div>
                      <img src={p.pfpUrl} alt="" className="w-9 h-9 rounded-full border border-white/10" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate text-gray-100">{p.username || shortAddr(p.address)}</div>
                        <div className="text-xs text-gray-500 truncate">{p.fid ? `FID ${p.fid}` : shortAddr(p.address)}</div>
                      </div>
                      <div className="font-extrabold text-green-200">{p.txCount}</div>
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

const castleCss = `
.cw-root{
  background:
    radial-gradient(1200px 600px at 50% -10%, rgba(243,211,107,.12), transparent 60%),
    radial-gradient(900px 500px at 20% 10%, rgba(93,169,255,.08), transparent 55%),
    radial-gradient(900px 500px at 80% 20%, rgba(102,242,181,.06), transparent 60%),
    linear-gradient(180deg, #0b0c12, #07070a);
  position:relative;
  overflow:hidden;
}
.cw-root:before{
  content:"";
  position:absolute;
  inset:-40px;
  opacity:.28;
  background:
    linear-gradient(90deg, rgba(255,255,255,.05) 2px, transparent 2px) 0 0/120px 60px,
    linear-gradient(0deg, rgba(255,255,255,.06) 2px, transparent 2px) 0 0/120px 60px,
    linear-gradient(90deg, rgba(0,0,0,.25) 1px, transparent 1px) 0 0/120px 60px,
    linear-gradient(90deg, rgba(255,255,255,.05) 2px, transparent 2px) 60px 30px/120px 60px,
    linear-gradient(0deg, rgba(255,255,255,.06) 2px, transparent 2px) 60px 30px/120px 60px;
  pointer-events:none;
}
.cw-shieldBadge{
  width:44px;height:44px;border-radius:14px;
  display:grid;place-items:center;
  background: linear-gradient(180deg, rgba(243,211,107,.18), rgba(243,211,107,.06));
  border:1px solid rgba(243,211,107,.22);
  box-shadow: 0 10px 30px rgba(0,0,0,.35);
  font-size:20px;
}
.cw-chip{
  display:inline-flex; gap:8px; align-items:center;
  padding:8px 10px;
  border-radius:999px;
  background:rgba(14,16,24,.7);
  border:1px solid rgba(35,38,58,.75);
  font-size:12px;
}
.cw-dot{ width:8px;height:8px;border-radius:999px;background:#66f2b5; box-shadow:0 0 0 3px rgba(102,242,181,.12); }
.cw-dot--off{ background:#555; box-shadow:none; }
.cw-tabs{
  display:flex;
  gap:10px;
  padding:10px;
  background:rgba(14,16,24,.55);
  border:1px solid rgba(35,38,58,.75);
  border-radius:16px;
  backdrop-filter: blur(10px);
}
.cw-tab{
  flex:1;
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  padding:10px 12px;
  border-radius:12px;
  border:1px solid transparent;
  background:transparent;
  color:#a9afc3;
  cursor:pointer;
  font-weight:800;
}
.cw-tab--active{
  background:rgba(11,13,20,.85);
  border-color:rgba(26,29,44,.9);
  color:#fff;
}
.cw-card{
  background:rgba(14,16,24,.70);
  border:1px solid rgba(35,38,58,.75);
  border-radius:18px;
  box-shadow: 0 18px 60px rgba(0,0,0,.55);
  backdrop-filter: blur(10px);
}
.cw-btn{
  flex:1;
  padding:10px 12px;
  border-radius:14px;
  border:1px solid rgba(35,38,58,.75);
  background:rgba(11,13,20,.85);
  color:#fff;
  font-weight:900;
}
.cw-btn--primary{
  border-color: rgba(93,169,255,.35);
}
.cw-btn--disabled{
  opacity:.45;
}
.cw-toast{
  border-radius:14px;
  border:1px solid rgba(35,38,58,.75);
  background:rgba(11,13,20,.85);
  padding:10px 12px;
  font-size:13px;
}
.cw-strike{
  width:100%;
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-top:10px;
  padding:14px 14px;
  border-radius:18px;
  border:1px solid rgba(35,38,58,.75);
  background:rgba(7,7,10,.55);
}
.cw-strike--base{ border-color: rgba(93,169,255,.35); }
.cw-strike--hyper{ border-color: rgba(102,242,181,.28); }
.cw-strike__h{ font-weight:950; font-size:16px; }
.cw-strike__s{ color:#a9afc3; font-size:12px; margin-top:2px; }
.cw-pill{
  padding:7px 10px;
  border-radius:999px;
  background:rgba(243,211,107,.14);
  border:1px solid rgba(243,211,107,.22);
  color:#f3d36b;
  font-weight:950;
  font-size:12px;
}
.cw-mini{
  padding:12px;
  border-radius:16px;
  background:rgba(7,7,10,.55);
  border:1px solid rgba(35,38,58,.55);
}
.cw-rowItem{
  display:flex; gap:10px; align-items:center;
  padding:10px 12px;
  border-radius:14px;
  background:rgba(7,7,10,.55);
  border:1px solid rgba(35,38,58,.55);
}
`;
