import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, ExternalLink, Shield, Swords, Crown } from 'lucide-react';
import sdk from '@farcaster/miniapp-sdk';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || 'https://chainwarz-backend-production.up.railway.app';

// ---------- Exact decimal -> wei using BigInt (no floating point) ----------
function parseUnits(amountStr, decimals = 18) {
  const s = String(amountStr).trim();
  const [wholeRaw, fracRaw = ''] = s.split('.');
  const whole = wholeRaw === '' ? '0' : wholeRaw;
  const frac = (fracRaw + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || '0');
}
function toHexWei(bi) {
  return '0x' + bi.toString(16);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Chains (supports BOTH Hyper IDs: 999 and 53460) ----------
const CHAINS = {
  base: {
    idHex: '0x2105', // 8453
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    contractAddress: '0xB2B23e69b9d811D3D43AD473f90A171D18b19aab',
    strikeAmountDecimal: '0.000001337',
    strikeSymbol: 'ETH'
  },
  // HyperEVM: prefer 999 if host advertises it; fallback to 53460 if needed
  hyperevm: {
    idHexPrimary: '0x3e7',  // 999
    idHexFallback: '0xd0d4', // 53460 (older config you used before)
    name: 'HyperEVM',
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    blockExplorer: 'https://explorer.hyperliquid.xyz',
    contractAddress: '0xDddED87c1f1487495E8aa47c9B43FEf4c5153054',
    strikeAmountDecimal: '0.0001337',
    strikeSymbol: 'HYPE'
  }
};

const RANKS = [
  { name: 'Squire', minStrikes: 0, color: 'text-gray-400' },
  { name: 'Knight', minStrikes: 100, color: 'text-blue-400' },
  { name: 'Knight Captain', minStrikes: 250, color: 'text-purple-400' },
  { name: 'Baron', minStrikes: 500, color: 'text-yellow-400' },
  { name: 'Duke', minStrikes: 1000, color: 'text-orange-400' },
  { name: 'Warlord', minStrikes: 2500, color: 'text-red-400' },
  { name: 'Legendary Champion', minStrikes: 5000, color: 'text-pink-400' }
];

function getRank(strikeCount) {
  for (let i = RANKS.length - 1; i >= 0; i--) {
    if (strikeCount >= RANKS[i].minStrikes) return RANKS[i];
  }
  return RANKS[0];
}

function shortAddr(a) {
  if (!a) return '';
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}

export default function App() {
  // Environment
  const [inMiniApp, setInMiniApp] = useState(false);
  const [hostChains, setHostChains] = useState([]);
  const [hostCaps, setHostCaps] = useState([]);

  // Wallet mode: 'farcaster' | 'browser'
  const [walletMode, setWalletMode] = useState(null);

  // Provider & wallet
  const [provider, setProvider] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);

  // UI state
  const [activeTab, setActiveTab] = useState('game');
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);

  // Data
  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });
  const [farcasterProfile, setFarcasterProfile] = useState(null);

  // Strike wei
  const strikeWei = useMemo(() => {
    return {
      base: parseUnits(CHAINS.base.strikeAmountDecimal, 18),
      hyperevm: parseUnits(CHAINS.hyperevm.strikeAmountDecimal, 18)
    };
  }, []);

  const strikeLabel = (key) => `${CHAINS[key].strikeAmountDecimal} ${CHAINS[key].strikeSymbol}`;

  // ---------- Helpers ----------
  const req = async (prov, method, params) => {
    if (!prov?.request) throw new Error('No wallet provider available');
    return prov.request({ method, params });
  };

  const refreshChainId = async (prov) => {
    const cid = await req(prov, 'eth_chainId');
    setChainId(cid);
    return cid;
  };

  const getHyperChainIdHex = () => {
    // If host says it supports eip155:999, prefer 999
    if (hostChains.includes('eip155:999')) return CHAINS.hyperevm.idHexPrimary;
    // If host does NOT expose chains (or is external), still try 999 first.
    return CHAINS.hyperevm.idHexPrimary;
  };

  const supportsHyperInThisHost = () => {
    // Outside Farcaster: let the user try; their wallet decides.
    if (!inMiniApp) return true;
    // Inside Farcaster: only enable if host advertises HyperEVM
    return hostChains.includes('eip155:999') || hostChains.includes('eip155:53460');
  };

  // ---------- Backend calls ----------
  const loadLeaderboard = async () => {
    try {
      const [baseRes, hyperRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/leaderboard/base`),
        fetch(`${BACKEND_URL}/api/leaderboard/hyperevm`)
      ]);

      const [baseData, hyperData] = await Promise.all([baseRes.json(), hyperRes.json()]);
      setLeaderboard({ base: baseData, hyperevm: hyperData });
    } catch {
      // silent
    }
  };

  const loadProfile = async (addr) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/profile/${addr}`);
      const data = await res.json();
      setFarcasterProfile(data);
    } catch {
      // silent
    }
  };

  // ---------- Init ----------
  useEffect(() => {
    (async () => {
      // 1) Detect miniapp
      let mini = false;
      try {
        if (typeof sdk?.isInMiniApp === 'function') {
          mini = await sdk.isInMiniApp();
        } else {
          // fallback heuristic
          mini = typeof window !== 'undefined' && window.parent !== window;
        }
      } catch {
        mini = false;
      }
      setInMiniApp(mini);

      // 2) Always call ready if possible (fixes splash)
      try {
        await sdk.actions.ready();
      } catch {}

      // 3) Runtime detect chains/caps (DO NOT DISPLAY to users)
      try {
        const caps = await sdk.getCapabilities();
        setHostCaps(Array.isArray(caps) ? caps : []);
      } catch {
        setHostCaps([]);
      }
      try {
        const chains = await sdk.getChains();
        setHostChains(Array.isArray(chains) ? chains : []);
      } catch {
        setHostChains([]);
      }

      // 4) Default wallet mode
      // If inside miniapp and host supports Farcaster provider, default to farcaster.
      const canFarcasterProvider = hostCaps.includes('wallet.getEthereumProvider');
      if (mini && canFarcasterProvider) setWalletMode('farcaster');
      else setWalletMode('browser');

      // 5) Load backend data
      loadLeaderboard();
    })();
  }, []);

  // ---------- Provider setup ----------
  const attachListeners = (prov) => {
    if (!prov?.on) return;

    prov.on('accountsChanged', (accs) => {
      const a = accs?.[0] || null;
      setAccount(a);
      if (a) loadProfile(a);
    });

    prov.on('chainChanged', (cid) => {
      setChainId(cid);
    });
  };

  const connectFarcasterWallet = async () => {
    try {
      setLoading(true);
      setStatus('Connecting Farcaster wallet...');

      const prov = await sdk.wallet.getEthereumProvider();
      setProvider(prov);
      setWalletMode('farcaster');
      attachListeners(prov);

      const accounts = await req(prov, 'eth_requestAccounts');
      const addr = accounts?.[0] || null;
      setAccount(addr);

      await refreshChainId(prov);
      if (addr) loadProfile(addr);

      setStatus(addr ? 'Farcaster wallet connected.' : 'Failed to connect Farcaster wallet.');
    } catch (e) {
      setStatus(`Farcaster connect failed: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const connectBrowserWallet = async () => {
    try {
      setLoading(true);
      setStatus('Connecting browser wallet...');

      const prov = typeof window !== 'undefined' ? window.ethereum : null;
      if (!prov?.request) throw new Error('No browser wallet found (install MetaMask/Coinbase extension)');

      setProvider(prov);
      setWalletMode('browser');
      attachListeners(prov);

      const accounts = await req(prov, 'eth_requestAccounts');
      const addr = accounts?.[0] || null;
      setAccount(addr);

      await refreshChainId(prov);
      if (addr) loadProfile(addr);

      setStatus(addr ? 'Browser wallet connected.' : 'Failed to connect browser wallet.');
    } catch (e) {
      setStatus(`Browser connect failed: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // ---------- Chain switch ----------
  const switchChain = async (chainKey) => {
    if (!provider) throw new Error('Connect a wallet first');

    if (chainKey === 'base') {
      await req(provider, 'wallet_switchEthereumChain', [{ chainId: CHAINS.base.idHex }]);
      return;
    }

    // HyperEVM: prefer host-supported ID, fallback if needed
    const hyperPrimary = getHyperChainIdHex();
    const hyperFallback = CHAINS.hyperevm.idHexFallback;

    // Try primary
    try {
      await req(provider, 'wallet_switchEthereumChain', [{ chainId: hyperPrimary }]);
      return;
    } catch (e) {
      // If in Farcaster, we do NOT auto-add chains (host decides)
      if (inMiniApp && walletMode === 'farcaster') {
        throw e;
      }
    }

    // Try fallback
    await req(provider, 'wallet_switchEthereumChain', [{ chainId: hyperFallback }]);
  };

  // ---------- Transaction ----------
  const simulateTxIfSafe = async (txParams) => {
    // Farcaster provider can throw “Unknown provider RPC error” on eth_call.
    // We skip simulation for farcaster wallet to avoid breaking the flow.
    if (walletMode === 'farcaster') return { ok: true, skipped: true };

    try {
      await req(provider, 'eth_call', [txParams, 'latest']);
      return { ok: true };
    } catch (e) {
      // If simulation fails, we still allow the user to attempt sending.
      return { ok: false, error: e?.message || String(e) };
    }
  };

  const sendTransaction = async (chainKey) => {
    try {
      if (!account) throw new Error('Connect your wallet first.');
      if (!provider) throw new Error('No provider selected.');

      if (chainKey === 'hyperevm' && inMiniApp && !supportsHyperInThisHost()) {
        throw new Error('HyperEVM is not supported by this Farcaster host wallet.');
      }

      setLoading(true);
      setTxHash('');

      const chainName = chainKey === 'base' ? 'Base' : 'HyperEVM';
      setStatus(`Switching to ${chainName}...`);
      await switchChain(chainKey);

      // Verify actual chain after switch
      const cid = await refreshChainId(provider);

      const expected =
        chainKey === 'base'
          ? CHAINS.base.idHex
          : (cid === CHAINS.hyperevm.idHexFallback ? CHAINS.hyperevm.idHexFallback : getHyperChainIdHex());

      if (cid !== expected) {
        throw new Error(`Chain switch failed. Expected ${expected}, got ${cid}`);
      }

      const valueHex =
        chainKey === 'base'
          ? toHexWei(strikeWei.base)
          : toHexWei(strikeWei.hyperevm);

      const to =
        chainKey === 'base' ? CHAINS.base.contractAddress : CHAINS.hyperevm.contractAddress;

      const txParams = { from: account, to, value: valueHex };

      // Optional simulation (skipped for farcaster)
      setStatus('Preparing transaction...');
      const sim = await simulateTxIfSafe(txParams);
      if (!sim.ok) {
        // Don’t block user. Just warn.
        setStatus(`Precheck warning (safe to try anyway): ${sim.error}`);
        await sleep(600);
      }

      setStatus('Confirm in your wallet...');
      const hash = await req(provider, 'eth_sendTransaction', [txParams]);

      setTxHash(hash);
      setStatus('Transaction sent!');

      setTimeout(() => {
        loadLeaderboard();
        if (account) loadProfile(account);
      }, 2500);
    } catch (e) {
      setStatus(`Transaction failed: ${e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const totalStrikes = farcasterProfile
    ? (farcasterProfile.txCount?.base || 0) + (farcasterProfile.txCount?.hyperevm || 0)
    : 0;

  const rank = getRank(totalStrikes);

  const explorerUrl = () => {
    if (!txHash) return '#';
    if (chainId === CHAINS.base.idHex) return `${CHAINS.base.blockExplorer}/tx/${txHash}`;
    return `${CHAINS.hyperevm.blockExplorer}/tx/${txHash}`;
  };

  // ---------- UI ----------
  return (
    <div
      className="min-h-screen bg-black text-white p-4"
      style={{ backgroundColor: '#000', color: '#fff', minHeight: '100vh' }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-b from-gray-900 to-black rounded-2xl border-2 border-gray-800 overflow-hidden">
          <div className="bg-gradient-to-r from-gray-800 via-gray-900 to-gray-800 p-6 border-b border-gray-700">
            <div className="flex items-center justify-center gap-3">
              <Shield className="text-gray-300" size={34} />
              <h1 className="text-4xl font-black tracking-tight">ChainWarZ</h1>
              <Swords className="text-gray-300" size={34} />
            </div>
            <p className="text-gray-400 text-center mt-2">Strike chains. Climb ranks. Dominate.</p>
          </div>

          <div className="p-6">
            {/* Status */}
            {status && (
              <div className="mb-4 bg-gray-950 border border-gray-800 rounded-lg p-3">
                <div className="text-sm text-gray-200 whitespace-pre-wrap">{status}</div>
              </div>
            )}

            {/* Wallet Card */}
            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 mb-6">
              <div className="flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs text-gray-500">Wallet</div>
                  <div className="text-white font-bold">
                    {account ? shortAddr(account) : 'Not connected'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {chainId ? `Chain: ${chainId}` : ''}
                  </div>
                </div>

                {/* Connect buttons */}
                {!account ? (
                  <div className="flex flex-col sm:flex-row gap-2">
                    {inMiniApp && (
                      <button
                        onClick={connectFarcasterWallet}
                        disabled={loading}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-2 rounded-lg font-bold flex items-center gap-2"
                      >
                        <Wallet size={18} />
                        Connect Farcaster Wallet
                      </button>
                    )}

                    <button
                      onClick={connectBrowserWallet}
                      disabled={loading}
                      className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 px-4 py-2 rounded-lg font-bold flex items-center gap-2"
                    >
                      <Wallet size={18} />
                      Connect Browser Wallet
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500">
                    Connected via: <span className="text-gray-200 font-semibold">{walletMode || 'unknown'}</span>
                  </div>
                )}
              </div>

              {txHash && (
                <div className="mt-4 bg-green-900/40 border border-green-800 rounded-lg p-3">
                  <div className="text-sm font-bold text-green-200">Tx sent</div>
                  <a
                    href={explorerUrl()}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-green-300 hover:text-white inline-flex items-center gap-1 mt-1"
                  >
                    {txHash.slice(0, 18)}... <ExternalLink size={12} />
                  </a>
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
              {['game', 'profile', 'leaderboard'].map((t) => (
                <button
                  key={t}
                  onClick={() => setActiveTab(t)}
                  className={`px-4 py-2 rounded-lg font-bold border transition ${
                    activeTab === t
                      ? 'bg-gray-800 border-gray-600'
                      : 'bg-black border-gray-800 text-gray-400 hover:border-gray-700'
                  }`}
                >
                  {t === 'game' ? 'Game' : t === 'profile' ? 'Profile' : 'Leaderboard'}
                </button>
              ))}
            </div>

            {/* Game */}
            {activeTab === 'game' && (
              <div className="space-y-4">
                {!account ? (
                  <div className="text-center py-10 text-gray-400">
                    Connect a wallet to strike.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <button
                      onClick={() => sendTransaction('base')}
                      disabled={loading}
                      className="bg-gradient-to-br from-blue-700 to-blue-900 border-2 border-blue-500 hover:brightness-110 disabled:opacity-50 rounded-xl p-6 text-left"
                    >
                      <div className="text-2xl font-black">Base</div>
                      <div className="text-xs text-blue-200 mt-1">Send {strikeLabel('base')}</div>
                      <div className="mt-4 font-bold">Strike Base</div>
                    </button>

                    <button
                      onClick={() => sendTransaction('hyperevm')}
                      disabled={loading || (inMiniApp && !supportsHyperInThisHost())}
                      className="bg-gradient-to-br from-green-700 to-green-900 border-2 border-green-500 hover:brightness-110 disabled:opacity-50 rounded-xl p-6 text-left"
                    >
                      <div className="text-2xl font-black">HyperEVM</div>
                      <div className="text-xs text-green-200 mt-1">Send {strikeLabel('hyperevm')}</div>
                      <div className="mt-4 font-bold">
                        {inMiniApp && !supportsHyperInThisHost()
                          ? 'Not supported in this host'
                          : 'Strike HyperEVM'}
                      </div>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Profile */}
            {activeTab === 'profile' && (
              <div>
                {!account ? (
                  <div className="text-center py-10 text-gray-400">
                    Connect a wallet to view profile.
                  </div>
                ) : farcasterProfile ? (
                  <div className="bg-gray-950 border border-gray-800 rounded-xl p-6">
                    <div className="flex items-start gap-4">
                      <img
                        src={farcasterProfile.pfpUrl}
                        alt="pfp"
                        className="w-16 h-16 rounded-full border-2 border-gray-700"
                      />
                      <div className="flex-1">
                        <div className="text-xl font-black">{farcasterProfile.displayName}</div>
                        <div className="text-gray-400">@{farcasterProfile.username}</div>
                        <div className={`mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-black border border-gray-800 ${rank.color}`}>
                          <Crown size={16} />
                          <span className="font-bold">{rank.name}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-6">
                      <div className="bg-black border border-gray-800 rounded-lg p-4">
                        <div className="text-xs text-gray-500">Base strikes</div>
                        <div className="text-2xl font-black text-blue-400">
                          {farcasterProfile.txCount?.base || 0}
                        </div>
                      </div>
                      <div className="bg-black border border-gray-800 rounded-lg p-4">
                        <div className="text-xs text-gray-500">Hyper strikes</div>
                        <div className="text-2xl font-black text-green-400">
                          {farcasterProfile.txCount?.hyperevm || 0}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 text-sm text-gray-400">
                      Total strikes: <span className="text-white font-bold">{totalStrikes}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-10 text-gray-400">Loading profile...</div>
                )}
              </div>
            )}

            {/* Leaderboard */}
            {activeTab === 'leaderboard' && (
              <div className="space-y-6">
                <div>
                  <div className="text-lg font-black text-blue-300 mb-2">Base</div>
                  <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
                    {(leaderboard.base || []).map((p, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 border-b border-gray-900">
                        <div className="w-8 text-gray-500 font-bold">#{p.rank}</div>
                        <img src={p.pfpUrl} alt="" className="w-8 h-8 rounded-full border border-gray-700" />
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-bold truncate">{p.username}</div>
                          <div className="text-xs text-gray-500">{shortAddr(p.address)}</div>
                        </div>
                        <div className="text-blue-300 font-black">{p.txCount}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-lg font-black text-green-300 mb-2">HyperEVM</div>
                  <div className="bg-gray-950 border border-gray-800 rounded-xl overflow-hidden">
                    {(leaderboard.hyperevm || []).map((p, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 border-b border-gray-900">
                        <div className="w-8 text-gray-500 font-bold">#{p.rank}</div>
                        <img src={p.pfpUrl} alt="" className="w-8 h-8 rounded-full border border-gray-700" />
                        <div className="flex-1 min-w-0">
                          <div className="text-white font-bold truncate">{p.username}</div>
                          <div className="text-xs text-gray-500">{shortAddr(p.address)}</div>
                        </div>
                        <div className="text-green-300 font-black">{p.txCount}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={loadLeaderboard}
                  className="bg-gray-800 hover:bg-gray-700 border border-gray-700 px-4 py-2 rounded-lg font-bold"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
