import React, { useEffect, useMemo, useState } from "react";
import { Wallet, ExternalLink, Shield, Swords, Crown } from "lucide-react";
import sdk from "@farcaster/miniapp-sdk";

// "Are we inside an iframe / host?"
const isInHost =
  typeof window !== "undefined" &&
  (window.parent !== window || window.location !== window.parent.location);

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || "https://chainwarz-backend-production.up.railway.app";

const CHAINS = {
  base: {
    id: "0x2105",
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    blockExplorer: "https://basescan.org",
    contractAddress: "0xB2B23e69b9d811D3D43AD473f90A171D18b19aab",
    strikeAmount: "0.000001337 ETH",
    weiAmount: 1337000000000,
  },
  hyperevm: {
    id: "0xd0d4",
    name: "HyperEVM",
    rpcUrl: "https://rpc.hyperliquid.xyz/evm",
    blockExplorer: "https://hyperevmscan.io",
    contractAddress: "0x044A0B2D6eF67F5B82e51ec7229D84C0e83C8f02",
    strikeAmount: "0.0001337 HYPE",
    weiAmount: 133700000000000,
  },
};

const RANKS = [
  { name: "Squire", minStrikes: 0, color: "text-gray-400" },
  { name: "Knight", minStrikes: 1, color: "text-blue-400" },
  { name: "Knight Captain", minStrikes: 5, color: "text-purple-400" },
  { name: "Baron", minStrikes: 10, color: "text-yellow-400" },
  { name: "Duke", minStrikes: 25, color: "text-orange-400" },
  { name: "Warlord", minStrikes: 50, color: "text-red-400" },
  { name: "Legendary Champion", minStrikes: 100, color: "text-pink-400" },
];

function getRank(strikeCount) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (strikeCount >= RANKS[i].minStrikes) return RANKS[i];
  }
  return RANKS[0];
}

function shortAddr(a) {
  if (!a) return "";
  return `${a.substring(0, 6)}…${a.substring(a.length - 4)}`;
}

function getExplorerTxUrl(chainKey, txHash) {
  if (!txHash) return "#";
  if (chainKey === "base") return `https://basescan.org/tx/${txHash}`;
  return `https://hyperevmscan.io/tx/${txHash}`;
}

export default function App() {
  const [activeTab, setActiveTab] = useState("game");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  const [account, setAccount] = useState(null);
  const [currentChain, setCurrentChain] = useState(null);
  const [txHash, setTxHash] = useState("");

  // Farcaster context user (fid + basic info)
  const [fcUser, setFcUser] = useState(null);

  // Profile shown in UI (merged from Neynar + strike counts)
  const [profile, setProfile] = useState(null);

  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });

  const totalStrikes = useMemo(() => {
    if (!profile?.txCount) return 0;
    return (profile.txCount.base || 0) + (profile.txCount.hyperevm || 0);
  }, [profile]);

  const currentRank = useMemo(() => getRank(totalStrikes), [totalStrikes]);

  // ---------- INIT ----------
  useEffect(() => {
    const init = async () => {
      try {
        if (isInHost) {
          const context = await sdk.context;
          setFcUser(context?.user || null);
          try {
            await sdk.actions.ready();
          } catch (e) {
            // safe to ignore if already called
          }
        }
      } catch (e) {
        // If context fails, we still run as normal web app
      }

      await checkConnection();
      await loadLeaderboard();
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- WALLET HELPERS ----------
  const updateCurrentChain = async () => {
    if (!window.ethereum) return;
    try {
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      setCurrentChain(chainId);
    } catch (e) {}
  };

  const checkConnection = async () => {
    if (!window.ethereum) return;
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts?.length) {
        setAccount(accounts[0]);
        await updateCurrentChain();
        await loadProfile(accounts[0]);
      }
    } catch (e) {}
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      setStatus("No wallet detected. Open inside Farcaster or install a browser wallet.");
      return;
    }

    try {
      setLoading(true);
      setStatus("Connecting wallet…");
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });

      if (!accounts?.length) {
        setStatus("No accounts returned.");
        return;
      }

      setAccount(accounts[0]);
      setStatus("Connected.");
      await updateCurrentChain();
      await loadProfile(accounts[0]);

      // keep things updated if user changes wallet/chain
      window.ethereum.on("accountsChanged", async (accs) => {
        if (accs?.length) {
          setAccount(accs[0]);
          await loadProfile(accs[0]);
        } else {
          setAccount(null);
          setProfile(null);
        }
      });

      window.ethereum.on("chainChanged", async () => {
        await updateCurrentChain();
      });
    } catch (e) {
      setStatus(`Connect failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------- PROFILE LOADING (THE IMPORTANT PART) ----------
  const loadProfile = async (address) => {
    try {
      // 1) always load strike counts by address
      const strikeReq = fetch(`${BACKEND_URL}/api/profile/${address}`).then((r) => r.json());

      // 2) if we have a Farcaster FID, load real Farcaster identity (bio, pfp, etc)
      const fid = fcUser?.fid;
      const fcReq = fid
        ? fetch(`${BACKEND_URL}/api/farcaster/user/${fid}`).then((r) => (r.ok ? r.json() : null))
        : Promise.resolve(null);

      const [strikeData, fcData] = await Promise.all([strikeReq, fcReq]);

      // Merge rules:
      // - Use fcData for username/displayName/pfp/bio when present
      // - Always use strikeData.txCount (truth source for strikes)
      const merged = {
        username: fcData?.username || strikeData?.username || "unknown",
        displayName: fcData?.displayName || strikeData?.displayName || "Knight",
        pfpUrl: fcData?.pfpUrl || strikeData?.pfpUrl,
        bio: fcData?.bio || strikeData?.bio || "",
        fid: fcData?.fid || strikeData?.fid || fid || null,
        warpcastUrl:
          fcData?.warpcastUrl ||
          (fcData?.username ? `https://warpcast.com/${fcData.username}` : null) ||
          (strikeData?.username ? `https://warpcast.com/${strikeData.username}` : null),
        txCount: strikeData?.txCount || { base: 0, hyperevm: 0 },
        address,
      };

      setProfile(merged);
    } catch (e) {
      // last-resort fallback
      setProfile({
        username: "unknown",
        displayName: "Knight",
        bio: "",
        pfpUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${address}`,
        fid: fcUser?.fid || null,
        warpcastUrl: null,
        txCount: { base: 0, hyperevm: 0 },
        address,
      });
    }
  };

  // ---------- LEADERBOARD ----------
  const loadLeaderboard = async () => {
    try {
      const [b, h] = await Promise.all([
        fetch(`${BACKEND_URL}/api/leaderboard/base`).then((r) => r.json()),
        fetch(`${BACKEND_URL}/api/leaderboard/hyperevm`).then((r) => r.json()),
      ]);
      setLeaderboard({ base: b || [], hyperevm: h || [] });
    } catch (e) {}
  };

  // ---------- TX SENDING ----------
  const switchChain = async (chainKey) => {
    const chain = CHAINS[chainKey];
    try {
      setLoading(true);
      setStatus(`Switching to ${chain.name}…`);
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: chain.id }],
      });
      await updateCurrentChain();
      setStatus(`Now on ${chain.name}.`);
    } catch (e) {
      setStatus(`Chain switch failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  const sendTransaction = async (chainKey) => {
    if (!account) {
      setStatus("Connect your wallet first.");
      return;
    }

    const chain = CHAINS[chainKey];

    try {
      setLoading(true);

      // Ensure correct chain selected
      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      if (chainId !== chain.id) {
        await switchChain(chainKey);
      }

      setStatus(`Preparing strike on ${chain.name}…`);

      const txParams = {
        from: account,
        to: chain.contractAddress,
        value: `0x${BigInt(chain.weiAmount).toString(16)}`,
        data: "0x",
      };

      const hash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [txParams],
      });

      setTxHash(hash);
      setStatus(`Strike sent on ${chain.name}!`);
      await loadProfile(account);
      await loadLeaderboard();
    } catch (e) {
      setStatus(`Transaction failed: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------- UI ----------
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto">
        <div className="p-5 border-b border-gray-800">
          <h1 className="text-4xl font-extrabold tracking-tight">ChainWarZ</h1>
          <p className="text-gray-400 mt-1">Strike chains. Climb ranks. Dominate.</p>

          <div className="flex gap-2 mt-4">
            <button
              className={`px-3 py-2 rounded-lg font-bold text-sm ${
                activeTab === "game" ? "bg-gray-900 border border-gray-700" : "bg-black border border-gray-900"
              }`}
              onClick={() => setActiveTab("game")}
            >
              <span className="inline-flex items-center gap-2">
                <Swords size={16} /> Game
              </span>
            </button>

            <button
              className={`px-3 py-2 rounded-lg font-bold text-sm ${
                activeTab === "profile" ? "bg-gray-900 border border-gray-700" : "bg-black border border-gray-900"
              }`}
              onClick={() => setActiveTab("profile")}
            >
              <span className="inline-flex items-center gap-2">
                <Shield size={16} /> Profile
              </span>
            </button>

            <button
              className={`px-3 py-2 rounded-lg font-bold text-sm ${
                activeTab === "leaderboard" ? "bg-gray-900 border border-gray-700" : "bg-black border border-gray-900"
              }`}
              onClick={() => setActiveTab("leaderboard")}
            >
              <span className="inline-flex items-center gap-2">
                <Crown size={16} /> Leaderboard
              </span>
            </button>
          </div>

          {account ? (
            <div className="mt-4 text-sm text-gray-300">
              Connected: <span className="font-mono">{shortAddr(account)}</span>
            </div>
          ) : (
            <div className="mt-4">
              <button
                onClick={connectWallet}
                disabled={loading}
                className="w-full bg-gradient-to-r from-gray-800 to-gray-900 border border-gray-700 rounded-xl px-4 py-3 font-bold inline-flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Wallet size={18} />
                {loading ? "Connecting…" : isInHost ? "Connect Farcaster Wallet" : "Connect Browser Wallet"}
              </button>
            </div>
          )}

          {status ? <div className="mt-3 text-sm text-gray-400">{status}</div> : null}
        </div>

        <div className="p-5">
          {activeTab === "game" && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={() => sendTransaction("base")}
                  disabled={loading || !account}
                  className="bg-gradient-to-br from-blue-800 to-blue-950 border border-blue-700 rounded-2xl p-5 text-left disabled:opacity-50"
                >
                  <div className="text-xl font-extrabold">Base</div>
                  <div className="text-sm text-blue-200 mt-1">Send {CHAINS.base.strikeAmount}</div>
                </button>

                <button
                  onClick={() => sendTransaction("hyperevm")}
                  disabled={loading || !account}
                  className="bg-gradient-to-br from-green-800 to-green-950 border border-green-700 rounded-2xl p-5 text-left disabled:opacity-50"
                >
                  <div className="text-xl font-extrabold">HyperEVM</div>
                  <div className="text-sm text-green-200 mt-1">Send {CHAINS.hyperevm.strikeAmount}</div>
                </button>
              </div>

              {txHash ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className="text-sm text-gray-300 font-bold mb-2">Last Tx</div>
                  <a
                    href={getExplorerTxUrl(currentChain === CHAINS.base.id ? "base" : "hyperevm", txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-gray-200 underline"
                  >
                    {txHash.substring(0, 18)}… <ExternalLink size={14} />
                  </a>
                </div>
              ) : null}
            </div>
          )}

          {activeTab === "profile" && (
            <div>
              {!account ? (
                <div className="text-gray-400">Connect a wallet to view your profile.</div>
              ) : !profile ? (
                <div className="text-gray-400">Loading profile…</div>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <div className="flex items-start gap-4">
                    <img
                      src={profile.pfpUrl}
                      alt="pfp"
                      className="w-24 h-24 rounded-full border border-gray-700"
                    />
                    <div className="flex-1">
                      <div className={`text-sm font-bold ${currentRank.color}`}>{currentRank.name}</div>
                      <div className="text-2xl font-extrabold">{profile.displayName}</div>

                      {profile.username ? (
                        <div className="mt-1">
                          <a
                            href={profile.warpcastUrl || `https://warpcast.com/${profile.username}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gray-300 underline inline-flex items-center gap-2"
                          >
                            @{profile.username} <ExternalLink size={14} />
                          </a>
                        </div>
                      ) : null}

                      {profile.bio ? <div className="mt-2 text-gray-400">{profile.bio}</div> : null}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mt-5">
                    <div className="bg-black border border-gray-800 rounded-xl p-3">
                      <div className="text-xs text-gray-500">Base strikes</div>
                      <div className="text-2xl font-extrabold text-blue-300">{profile.txCount.base || 0}</div>
                    </div>

                    <div className="bg-black border border-gray-800 rounded-xl p-3">
                      <div className="text-xs text-gray-500">HyperEVM strikes</div>
                      <div className="text-2xl font-extrabold text-green-300">{profile.txCount.hyperevm || 0}</div>
                    </div>
                  </div>

                  <div className="text-xs text-gray-600 mt-4">
                    {isInHost ? "Running inside host" : "Running in browser"}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "leaderboard" && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="text-xl font-extrabold">Leaderboard</div>
                <button
                  onClick={loadLeaderboard}
                  className="text-sm px-3 py-2 rounded-lg bg-gray-900 border border-gray-800"
                >
                  Refresh
                </button>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-3 font-bold border-b border-gray-800 text-blue-300">Base</div>
                {leaderboard.base?.length ? (
                  leaderboard.base.map((p) => (
                    <div key={`${p.address}-base`} className="flex items-center gap-3 p-3 border-b border-gray-800">
                      <div className="w-10 font-extrabold text-gray-400">#{p.rank}</div>
                      <img src={p.pfpUrl} alt="" className="w-10 h-10 rounded-full border border-gray-700" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate">{p.username}</div>
                        <div className="text-sm text-gray-400">{p.txCount} strikes</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-gray-500">No data yet.</div>
                )}
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="p-3 font-bold border-b border-gray-800 text-green-300">HyperEVM</div>
                {leaderboard.hyperevm?.length ? (
                  leaderboard.hyperevm.map((p) => (
                    <div key={`${p.address}-hyperevm`} className="flex items-center gap-3 p-3 border-b border-gray-800">
                      <div className="w-10 font-extrabold text-gray-400">#{p.rank}</div>
                      <img src={p.pfpUrl} alt="" className="w-10 h-10 rounded-full border border-gray-700" />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold truncate">{p.username}</div>
                        <div className="text-sm text-gray-400">{p.txCount} strikes</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-4 text-gray-500">No data yet.</div>
                )}
              </div>

              <div className="text-xs text-gray-600">{isInHost ? "Running inside host" : "Running in browser"}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
