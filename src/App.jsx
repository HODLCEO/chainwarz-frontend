import React, { useEffect, useMemo, useState } from "react";
import { Wallet, ExternalLink, Shield, Swords, Crown } from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";
import "./App.css";

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL ||
  "https://chainwarz-backend-production.up.railway.app";

const CHAINS = {
  base: {
    key: "base",
    chainIdHex: "0x2105", // 8453
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    contractAddress: "0xB2B23e69b9d811D3D43AD473f90A171D18b19aab",
    // ✅ correct amount for your current Base contract
    valueWei: 1337420690000n,
    strikeLabel: "0.00000133742069 ETH",
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
  { name: "Squire", min: 0, className: "rank-squire" },
  { name: "Knight", min: 1, className: "rank-knight" },
  { name: "Knight Captain", min: 5, className: "rank-captain" },
  { name: "Baron", min: 10, className: "rank-baron" },
  { name: "Duke", min: 25, className: "rank-duke" },
  { name: "Warlord", min: 50, className: "rank-warlord" },
  { name: "Legendary Champion", min: 100, className: "rank-legend" },
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

function TabButton({ active, onClick, icon, label }) {
  return (
    <button onClick={onClick} className={`cw-tab ${active ? "active" : ""}`}>
      <span className="cw-tabIcon" aria-hidden>
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
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
    // Prefer Farcaster provider in-host
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

  const loadFarcasterIdentity = async () => {
    try {
      const fid = fcUser?.fid;
      if (!fid) return null;

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
        if (mini) {
          await sdk.context;
          await sdk.actions.ready();
          setFcUser(sdk.context?.user || null);

          const caps = await sdk.getCapabilities();
          if (caps.includes("wallet.getEthereumProvider")) {
            const p = await sdk.wallet.getEthereumProvider();
            if (p) setFcProvider(p);
          }
        }
      } catch {}

      loadLeaderboards();
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When profile tab is opened, try to load identity
  useEffect(() => {
    const run = async () => {
      if (activeTab !== "profile") return;
      const ident = await loadFarcasterIdentity();
      if (ident) setProfileIdentity(ident);
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, fcUser?.fid]);

  const requestAccounts = async (provider, viaLabel) => {
    if (!provider?.request) {
      setStatus("No wallet provider found.");
      return null;
    }

    try {
      setLoading(true);
      setStatus(
        viaLabel === "farcaster"
          ? "Connecting Farcaster wallet…"
          : "Connecting browser wallet…"
      );

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

      const ident = await loadFarcasterIdentity();
      if (ident) setProfileIdentity(ident);

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

  // Identity display priority
  const displayName =
    profileIdentity?.displayName ||
    profileIdentity?.display_name ||
    (fcUser?.displayName || fcUser?.username) ||
    (account ? shortAddr(account) : "Unknown");

  const username =
    (profileIdentity?.username ? `@${profileIdentity.username}` : "") ||
    (fcUser?.username ? `@${fcUser.username}` : "");

  const pfpUrl =
    profileIdentity?.pfpUrl ||
    profileIdentity?.pfp_url ||
    fcUser?.pfpUrl ||
    (account ? `https://api.dicebear.com/7.x/avataaars/svg?seed=${account}` : "");

  const bio = profileIdentity?.bio || profileIdentity?.profile?.bio?.text || "";

  const warpcastUrl =
    profileIdentity?.warpcastUrl ||
    (profileIdentity?.username ? `https://warpcast.com/${profileIdentity.username}` : null) ||
    (fcUser?.username ? `https://warpcast.com/${fcUser.username}` : null);

  const connectedLabel = account ? (connectedVia || "host") : "not connected";

  return (
    <div className="cw-root">
      <div className="cw-shell">
        {/* HEADER */}
        <header className="cw-header">
          <div className="cw-mark">
            <div className="cw-shieldMark" aria-hidden>
              <Shield size={18} />
            </div>
            <div>
              <h1 className="cw-title">ChainWarZ</h1>
              <p className="cw-subtitle">Strike chains. Climb ranks. Dominate.</p>
            </div>
          </div>

          <div className="cw-connection">
            <div className="cw-chip">
              <span className="cw-dot" />
              <span>
                Connected via <b>{connectedLabel}</b>
              </span>
            </div>
            <div className="cw-addr">{account ? shortAddr(account) : "—"}</div>
          </div>
        </header>

        {/* TABS */}
        <nav className="cw-tabs" aria-label="Primary">
          <TabButton
            active={activeTab === "game"}
            onClick={() => setActiveTab("game")}
            icon={<Swords size={16} />}
            label="Game"
          />
          <TabButton
            active={activeTab === "profile"}
            onClick={() => setActiveTab("profile")}
            icon={<Shield size={16} />}
            label="Profile"
          />
          <TabButton
            active={activeTab === "leaderboard"}
            onClick={() => setActiveTab("leaderboard")}
            icon={<Crown size={16} />}
            label="Leaderboard"
          />
        </nav>

        {/* STATUS */}
        {status ? (
          <div className="cw-card cw-status">
            <p className="cw-muted">{status}</p>
          </div>
        ) : null}

        {/* GAME */}
        {activeTab === "game" && (
          <main className="cw-grid">
            <section className="cw-card">
              <h2>Connect</h2>
              <p className="cw-muted">
                Farcaster wallet (in-host) or Browser wallet.
              </p>

              <div className="cw-row">
                <button
                  className={`cw-btn primary ${!fcProvider ? "disabled" : ""}`}
                  onClick={() => requestAccounts(fcProvider, "farcaster")}
                  disabled={!fcProvider || loading}
                >
                  <span className="cw-btnIcon" aria-hidden>
                    <Wallet size={16} />
                  </span>
                  Connect Farcaster
                </button>

                <button
                  className={`cw-btn ${!browserProvider ? "disabled" : ""}`}
                  onClick={() => requestAccounts(browserProvider, "browser")}
                  disabled={!browserProvider || loading}
                >
                  <span className="cw-btnIcon" aria-hidden>
                    <Wallet size={16} />
                  </span>
                  Connect Browser
                </button>
              </div>

              <div className="cw-divider" />

              <div className="cw-statRow">
                <div className="cw-stat">
                  <div className="cw-statK">Total strikes</div>
                  <div className="cw-statV">{totalStrikes}</div>
                </div>
                <div className="cw-stat">
                  <div className="cw-statK">Current rank</div>
                  <div className={`cw-statV ${currentRank.className}`}>
                    {currentRank.name}
                  </div>
                </div>
              </div>

              {currentChainId ? (
                <div className="cw-footNote">Chain: {currentChainId}</div>
              ) : null}
            </section>

            <section className="cw-card cw-cardGlow">
              <h2>Strike</h2>
              <p className="cw-muted">Send a tiny value to record your strike.</p>

              <button
                onClick={() => sendStrike("base")}
                disabled={!account || loading}
                className={`cw-strike cw-strikeBase ${!account ? "disabled" : ""}`}
              >
                <div>
                  <div className="cw-strikeH">Base</div>
                  <div className="cw-strikeS">{CHAINS.base.strikeLabel}</div>
                </div>
                <span className="cw-pill">
                  <Swords size={14} /> Strike
                </span>
              </button>

              <button
                onClick={() => sendStrike("hyperevm")}
                disabled={!account || loading}
                className={`cw-strike cw-strikeHyper ${!account ? "disabled" : ""}`}
              >
                <div>
                  <div className="cw-strikeH">HyperEVM</div>
                  <div className="cw-strikeS">{CHAINS.hyperevm.strikeLabel}</div>
                </div>
                <span className="cw-pill">
                  <Swords size={14} /> Strike
                </span>
              </button>

              {lastTx?.hash ? (
                <div className="cw-lastTx">
                  <span className="cw-muted">Last tx</span>
                  <a
                    className="cw-link"
                    href={explorerTxUrl()}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shortAddr(lastTx.hash)} <ExternalLink size={14} />
                  </a>
                </div>
              ) : null}
            </section>
          </main>
        )}

        {/* PROFILE */}
        {activeTab === "profile" && (
          <main className="cw-card">
            {!account ? (
              <p className="cw-muted">Connect a wallet to see your profile.</p>
            ) : (
              <>
                <div className="cw-profile">
                  {/* Smaller PFP (40–60% vibe) */}
                  <img
                    src={pfpUrl}
                    alt="pfp"
                    className="cw-pfp"
                    style={{ width: 56, height: 56 }}
                  />

                  <div className="cw-profileMain">
                    <div className={`cw-rank ${currentRank.className}`}>
                      {currentRank.name}
                    </div>

                    <div className="cw-name">{displayName}</div>

                    {username ? (
                      <div className="cw-handle">{username}</div>
                    ) : null}

                    {bio ? <div className="cw-bio">{bio}</div> : null}

                    {warpcastUrl ? (
                      <a
                        className="cw-link"
                        href={warpcastUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on Warpcast <ExternalLink size={14} />
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="cw-divider" />

                <div className="cw-two">
                  <div className="cw-mini">
                    <div className="cw-miniK">Base strikes</div>
                    <div className="cw-miniV">{profileCounts.base}</div>
                  </div>
                  <div className="cw-mini">
                    <div className="cw-miniK">HyperEVM strikes</div>
                    <div className="cw-miniV">{profileCounts.hyperevm}</div>
                  </div>
                </div>

                <div className="cw-footNote">Running inside host</div>
              </>
            )}
          </main>
        )}

        {/* LEADERBOARD */}
        {activeTab === "leaderboard" && (
          <main className="cw-grid">
            <section className="cw-card">
              <div className="cw-cardHead">
                <h2>Base Leaderboard</h2>
                <button className="cw-linkBtn" onClick={loadLeaderboards} disabled={loading}>
                  Refresh
                </button>
              </div>

              {leaderboard.base?.length ? (
                <div className="cw-list">
                  {leaderboard.base.slice(0, 10).map((p) => (
                    <div key={`b-${p.address}`} className="cw-rowItem">
                      <div className="cw-rankNum">#{p.rank}</div>
                      <img
                        src={p.pfpUrl}
                        alt=""
                        className="cw-avatarSm"
                      />
                      <div className="cw-rowName">
                        <div className="cw-rowTop">
                          {p.username || shortAddr(p.address)}
                        </div>
                        <div className="cw-rowSub">{shortAddr(p.address)}</div>
                      </div>
                      <div className="cw-rowScore cw-scoreBase">{p.txCount}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="cw-muted">No data yet.</p>
              )}
            </section>

            <section className="cw-card">
              <div className="cw-cardHead">
                <h2>HyperEVM Leaderboard</h2>
                <button className="cw-linkBtn" onClick={loadLeaderboards} disabled={loading}>
                  Refresh
                </button>
              </div>

              {leaderboard.hyperevm?.length ? (
                <div className="cw-list">
                  {leaderboard.hyperevm.slice(0, 10).map((p) => (
                    <div key={`h-${p.address}`} className="cw-rowItem">
                      <div className="cw-rankNum">#{p.rank}</div>
                      <img
                        src={p.pfpUrl}
                        alt=""
                        className="cw-avatarSm"
                      />
                      <div className="cw-rowName">
                        <div className="cw-rowTop">
                          {p.username || shortAddr(p.address)}
                        </div>
                        <div className="cw-rowSub">{shortAddr(p.address)}</div>
                      </div>
                      <div className="cw-rowScore cw-scoreHyper">{p.txCount}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="cw-muted">No data yet.</p>
              )}
            </section>
          </main>
        )}

        <footer className="cw-footer">
          <span className="cw-muted">Built for Farcaster Mini Apps</span>
        </footer>
      </div>
    </div>
  );
}
