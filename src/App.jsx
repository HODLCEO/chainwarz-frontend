import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, ExternalLink, Trophy, Shield, Swords, Crown } from 'lucide-react';
import { sdk } from '@farcaster/miniapp-sdk';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || 'https://chainwarz-backend-production.up.railway.app';

// --------- Exact BigInt money helpers (no floating point) ----------
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

// --------- Chains ----------
const CHAINS = {
  base: {
    caip2: 'eip155:8453',
    idHex: '0x2105',
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    contractAddress: '0xB2B23e69b9d811D3D43AD473f90A171D18b19aab',
    strikeAmountDecimal: '0.000001337',
    strikeSymbol: 'ETH'
  },
  hyperevm: {
    caip2: 'eip155:999',
    idHex: '0x3e7',
    name: 'HyperEVM',
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    blockExplorer: 'https://explorer.hyperliquid.xyz',
    contractAddress: '0xDddED87c1f1487495E8aa47c9B43FEf4c5153054',
    strikeAmountDecimal: '0.0001337',
    strikeSymbol: 'HYPE'
  }
};

// --------- Ranks (unchanged) ----------
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

export default function App() {
  // Wallet + Host detection
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [capabilities, setCapabilities] = useState([]);
  const [chains, setChains] = useState([]);
  const [supportsWalletProvider, setSupportsWalletProvider] = useState(false);
  const [supportsHyperEvm, setSupportsHyperEvm] = useState(false);

  // Provider + account
  const [ethProvider, setEthProvider] = useState(null);
  const [account, setAccount] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);

  // App data
  const [farcasterProfile, setFarcasterProfile] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });

  // UI
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('game');

  // Strike amounts computed exactly
  const strikeWei = useMemo(() => {
    return {
      base: parseUnits(CHAINS.base.strikeAmountDecimal, 18),
      hyperevm: parseUnits(CHAINS.hyperevm.strikeAmountDecimal, 18)
    };
  }, []);

  const strikeLabel = (key) => `${CHAINS[key].strikeAmountDecimal} ${CHAINS[key].strikeSymbol}`;

  // ---------- provider wrappers ----------
  const providerRequest = async (provider, method, params) => {
    if (!provider?.request) throw new Error('No EIP-1193 provider available');
    return provider.request({ method, params });
  };

  const refreshChainId = async (provider) => {
    const cid = await providerRequest(provider, 'eth_chainId');
    setCurrentChainId(cid);
    return cid;
  };

  const getProvider = async (mini, supportsWallet) => {
    if (mini && supportsWallet) {
      return await sdk.wallet.getEthereumProvider();
    }
    // fallback for normal browsers
    return typeof window !== 'undefined' ? window.ethereum : null;
  };

  const attachProviderListeners = (provider) => {
    if (!provider?.on) return;

    provider.on('accountsChanged', (accounts) => {
      const addr = accounts?.[0] || null;
      setAccount(addr);
      if (addr) loadFarcasterProfile(addr);
    });

    provider.on('chainChanged', (cid) => {
      setCurrentChainId(cid);
    });
  };

  // ---------- init ----------
  useEffect(() => {
    (async () => {
      // A) detect miniapp
      let mini = false;
      try {
        mini = await sdk.isInMiniApp();
      } catch {
        mini = false;
      }
      setIsMiniApp(mini);

      // B) ready() if miniapp (prevents splash/ready warning)
      if (mini) {
        try {
          await sdk.actions.ready();
        } catch {}
      }

      // C) detect capabilities + chains (runtime detection)
      let caps = [];
      let chs = [];
      try {
        caps = await sdk.getCapabilities();
      } catch {
        caps = [];
      }
      try {
        chs = await sdk.getChains();
      } catch {
        chs = [];
      }

      setCapabilities(caps);
      setChains(chs);

      const supportsWallet = caps.includes('wallet.getEthereumProvider');
      setSupportsWalletProvider(supportsWallet);

      // HyperEVM support: host must both support wallet provider AND list chain
      const hyper = supportsWallet && chs.includes(CHAINS.hyperevm.caip2);
      setSupportsHyperEvm(hyper);

      // D) pick provider
      const provider = await getProvider(mini, supportsWallet);
      setEthProvider(provider);

      // E) attach + auto-check connection
      if (provider) {
        attachProviderListeners(provider);
        await checkConnection(provider);
      }

      // F) load data
      loadLeaderboard();
    })();
  }, []);

  // ---------- backend ----------
  const loadLeaderboard = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/leaderboard`);
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data);
      }
    } catch {}
  };

  const loadFarcasterProfile = async (walletAddress) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/profile/${walletAddress}`);
      if (response.ok) {
        const data = await response.json();
        setFarcasterProfile(data);
      }
    } catch {}
  };

  // ---------- wallet ----------
  const checkConnection = async (provider) => {
    try {
      const accounts = await providerRequest(provider, 'eth_accounts');
      if (accounts?.length) {
        setAccount(accounts[0]);
        await refreshChainId(provider);
        loadFarcasterProfile(accounts[0]);
      }
    } catch {}
  };

  const connectWallet = async () => {
    try {
      setLoading(true);

      if (!ethProvider) {
        setStatus('No wallet provider detected.');
        return;
      }

      setStatus(isMiniApp ? 'Connecting Farcaster wallet...' : 'Connecting wallet...');
      const accounts = await providerRequest(ethProvider, 'eth_requestAccounts');
      const addr = accounts?.[0] || null;
      setAccount(addr);

      await refreshChainId(ethProvider);
      if (addr) loadFarcasterProfile(addr);

      setStatus(addr ? 'Wallet connected.' : 'Wallet connection failed.');
    } catch (err) {
      setStatus(`Connect failed: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  // Switch chain
  const switchChain = async (chainKey) => {
    const chain = CHAINS[chainKey];
    if (!ethProvider) throw new Error('No wallet provider');

    setStatus(`Switching to ${chain.name}...`);

    // Try switch first
    try {
      await providerRequest(ethProvider, 'wallet_switchEthereumChain', [{ chainId: chain.idHex }]);
    } catch (err) {
      // In Farcaster miniapp: DO NOT auto-add chains (common failure / inconsistent)
      const msg = (err?.message || '').toLowerCase();
      const chainNotAdded = err?.code === 4902 || msg.includes('unrecognized') || msg.includes('not added');

      if (chainNotAdded && isMiniApp) {
        throw new Error(
          `${chain.name} is not available in this host wallet. ` +
          `This Mini App will only show HyperEVM when the host supports it.`
        );
      }

      // In external wallets: try add then switch
      if (chainNotAdded) {
        await providerRequest(ethProvider, 'wallet_addEthereumChain', [
          {
            chainId: chain.idHex,
            chainName: chain.name,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.blockExplorer],
            nativeCurrency: {
              name: chain.name,
              symbol: chainKey === 'base' ? 'ETH' : 'HYPE',
              decimals: 18
            }
          }
        ]);
        await providerRequest(ethProvider, 'wallet_switchEthereumChain', [{ chainId: chain.idHex }]);
      } else {
        throw err;
      }
    }

    // Confirm actually switched
    for (let i = 0; i < 10; i++) {
      const cid = await refreshChainId(ethProvider);
      if (cid === chain.idHex) return;
      await sleep(250);
    }
    throw new Error('Chain switch did not complete.');
  };

  // Simulation before sending (prevents “Incorrect strike amount” surprises)
  const simulateTx = async (txParams) => {
    try {
      await providerRequest(ethProvider, 'eth_call', [txParams, 'latest']);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  };

  const sendTransaction = async (chainKey) => {
    if (!account) {
      setStatus('Connect wallet first.');
      return;
    }
    if (!ethProvider) {
      setStatus('No wallet provider.');
      return;
    }

    // Runtime gate: HyperEVM button shouldn’t even show unless supported,
    // but we double-check in case of edge cases.
    if (chainKey === 'hyperevm' && !supportsHyperEvm) {
      setStatus('HyperEVM is not supported by this host wallet.');
      return;
    }

    const chain = CHAINS[chainKey];
    const valueHex = toHexWei(strikeWei[chainKey]);

    try {
      setLoading(true);
      setTxHash('');

      await switchChain(chainKey);

      const cid = await refreshChainId(ethProvider);
      if (cid !== chain.idHex) {
        throw new Error(`Wrong chain. Expected ${chain.name} (${chain.idHex}), got ${cid}`);
      }

      const txParams = {
        from: account,
        to: chain.contractAddress,
        value: valueHex
      };

      setStatus(`Simulating strike on ${chain.name}...`);
      const sim = await simulateTx(txParams);
      if (!sim.ok) {
        throw new Error(`Simulation failed: ${sim.error}`);
      }

      setStatus(`Confirm strike: Send ${strikeLabel(chainKey)}...`);
      const hash = await providerRequest(ethProvider, 'eth_sendTransaction', [txParams]);

      setTxHash(hash);
      setStatus(`Transaction sent on ${chain.name}!`);

      setTimeout(() => {
        loadLeaderboard();
        if (account) loadFarcasterProfile(account);
      }, 2500);
    } catch (err) {
      setStatus(`Transaction failed: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const openExplorer = (chainKey, hash) => {
    window.open(`${CHAINS[chainKey].blockExplorer}/tx/${hash}`, '_blank');
  };

  const totalStrikes =
    (farcasterProfile?.txCount?.base || 0) + (farcasterProfile?.txCount?.hyperevm || 0);
  const rank = getRank(totalStrikes);

  return (
    <div className="min-h-screen bg-black p-4 relative overflow-hidden">
      {isMiniApp && (
        <div className="fixed top-4 right-4 bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-bold z-50 flex items-center gap-2">
          <span>FARCASTER</span>
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-white mb-2 flex items-center justify-center gap-3">
            <Swords className="text-red-500" size={40} />
            ChainWarZ
            <Swords className="text-red-500" size={40} />
          </h1>
          <p className="text-gray-400 text-lg">Strike chains. Climb ranks. Dominate.</p>
        </div>

        {/* Host support panel (useful while you’re debugging) */}
        {isMiniApp && (
          <div className="mb-4 p-3 bg-gray-900 rounded-lg border border-gray-700 text-xs text-gray-300">
            <div><b>Host capabilities detected:</b></div>
            <div>Supports wallet provider: {supportsWalletProvider ? 'YES' : 'NO'}</div>
            <div>Chains: {chains.length ? chains.join(', ') : '(none detected)'}</div>
            <div>HyperEVM enabled: {supportsHyperEvm ? 'YES' : 'NO'}</div>
          </div>
        )}

        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          {status && (
            <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700 text-center">
              <p className="text-white font-medium whitespace-pre-wrap">{status}</p>
            </div>
          )}

          {/* Wallet */}
          <div className="mb-6">
            {!account ? (
              <button
                onClick={connectWallet}
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2 border-2 border-blue-400"
              >
                <Wallet size={20} />
                {loading ? 'Connecting...' : isMiniApp ? 'Connect Farcaster Wallet' : 'Connect Wallet'}
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                  <p className="text-gray-400 text-sm">Connected Wallet</p>
                  <p className="text-white font-mono text-sm">
                    {account.slice(0, 6)}...{account.slice(-4)}
                  </p>
                  <p className="text-gray-400 text-sm mt-2">Chain ID</p>
                  <p className="text-white font-bold">{currentChainId || 'Unknown'}</p>
                </div>

                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                  <p className="text-gray-400 text-sm">Farcaster Profile</p>
                  {farcasterProfile ? (
                    <div>
                      <p className="text-white font-bold">@{farcasterProfile.username}</p>
                      <p className={`text-sm font-bold ${rank.color}`}>
                        <Crown className="inline mr-1" size={14} />
                        {rank.name}
                      </p>
                      <p className="text-gray-400 text-sm">Total Strikes: {totalStrikes}</p>
                    </div>
                  ) : (
                    <p className="text-gray-500">Loading profile...</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Base always available */}
            <div className="bg-gray-800 p-6 rounded-xl border-2 border-gray-700 hover:border-red-500 transition">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Shield className="text-blue-400" /> Base
                </h3>
                <span className="text-gray-400 text-sm">{strikeLabel('base')}</span>
              </div>

              <button
                onClick={() => sendTransaction('base')}
                disabled={!account || loading}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2 border-2 border-red-400"
              >
                {loading ? 'Striking...' : 'Strike Base'}
              </button>
            </div>

            {/* HyperEVM only if host supports it */}
            <div className="bg-gray-800 p-6 rounded-xl border-2 border-gray-700 hover:border-red-500 transition">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Swords className="text-green-400" /> HyperEVM
                </h3>
                <span className="text-gray-400 text-sm">{strikeLabel('hyperevm')}</span>
              </div>

              {supportsHyperEvm ? (
                <button
                  onClick={() => sendTransaction('hyperevm')}
                  disabled={!account || loading}
                  className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2 border-2 border-red-400"
                >
                  {loading ? 'Striking...' : 'Strike HyperEVM'}
                </button>
              ) : (
                <div className="p-3 bg-black border border-gray-700 rounded-lg text-sm text-gray-300">
                  HyperEVM is not supported by this host wallet right now.
                  <div className="text-xs text-gray-500 mt-2">
                    (We detected chains/capabilities at runtime and disabled this button.)
                  </div>
                </div>
              )}
            </div>
          </div>

          {txHash && (
            <div className="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-600">
              <p className="text-gray-400 text-sm mb-1">Last Tx</p>
              <button
                onClick={() => openExplorer(currentChainId === CHAINS.base.idHex ? 'base' : 'hyperevm', txHash)}
                className="text-blue-400 hover:text-blue-300 text-sm font-mono flex items-center gap-1"
              >
                {txHash.slice(0, 10)}...{txHash.slice(-8)}
                <ExternalLink size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
