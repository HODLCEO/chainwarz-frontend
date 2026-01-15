import React, { useEffect, useMemo, useState } from 'react';
import { Wallet, ExternalLink, Shield, Swords, Crown } from 'lucide-react';
import { sdk } from '@farcaster/miniapp-sdk';

const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || 'https://chainwarz-backend-production.up.railway.app';

// ✅ EXACT strike amount required by BOTH contracts
// STRIKE_AMOUNT = 1337420690000 wei = 0.00000133742069 (18 decimals)
const STRIKE_WEI = 1337420690000n;
const STRIKE_DECIMAL = '0.00000133742069';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toHexWei(bi) {
  return '0x' + bi.toString(16);
}

const CHAINS = {
  base: {
    caip2: 'eip155:8453',
    idHex: '0x2105',
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    contractAddress: '0xB2B23e69b9d811D3D43AD473f90A171D18b19aab',
    strikeAmountDecimal: STRIKE_DECIMAL,
    strikeSymbol: 'ETH'
  },
  hyperevm: {
    caip2: 'eip155:999',
    idHex: '0x3e7',
    name: 'HyperEVM',
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    blockExplorer: 'https://hyperevmscan.io',
    contractAddress: '0xDddED87c1f1487495E8aa47c9B43FEf4c5153054',
    // ✅ SAME exact strike amount as Base (contract is identical)
    strikeAmountDecimal: STRIKE_DECIMAL,
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
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [capabilities, setCapabilities] = useState([]);
  const [chains, setChains] = useState([]);

  const [ethProvider, setEthProvider] = useState(null);
  const [walletMode, setWalletMode] = useState(null); // 'farcaster' | 'browser'

  const [account, setAccount] = useState(null);
  const [currentChainId, setCurrentChainId] = useState(null);

  const [farcasterProfile, setFarcasterProfile] = useState(null);
  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });

  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('game');

  const strikeWei = useMemo(() => {
    // ✅ Both chains use the same STRIKE_WEI
    return {
      base: STRIKE_WEI,
      hyperevm: STRIKE_WEI
    };
  }, []);

  const strikeLabel = (key) => `${CHAINS[key].strikeAmountDecimal} ${CHAINS[key].strikeSymbol}`;

  const providerRequest = async (provider, method, params) => {
    if (!provider?.request) throw new Error('No EIP-1193 provider available');
    return provider.request({ method, params });
  };

  const refreshChainId = async (provider) => {
    const cid = await providerRequest(provider, 'eth_chainId');
    setCurrentChainId(cid);
    return cid;
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

  const loadLeaderboard = async () => {
    try {
      const [baseRes, hyperRes] = await Promise.all([
        fetch(`${BACKEND_URL}/api/leaderboard/base`),
        fetch(`${BACKEND_URL}/api/leaderboard/hyperevm`)
      ]);

      const [baseData, hyperData] = await Promise.all([baseRes.json(), hyperRes.json()]);
      setLeaderboard({ base: baseData, hyperevm: hyperData });
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

  const supportsHyperEvmInHost = () => {
    // outside Farcaster: allow trying
    if (!isMiniApp) return true;
    // inside Farcaster: only enable if host reports it
    return chains.includes('eip155:999') || chains.includes('eip155:53460');
  };

  useEffect(() => {
    (async () => {
      // detect miniapp
      let mini = false;
      try {
        mini = await sdk.isInMiniApp();
      } catch {
        mini = false;
      }
      setIsMiniApp(mini);

      // call ready (fix splash)
      try {
        await sdk.actions.ready();
      } catch {}

      // detect caps/chains (do NOT show to users)
      try {
        const caps = await sdk.getCapabilities();
        setCapabilities(Array.isArray(caps) ? caps : []);
      } catch {
        setCapabilities([]);
      }
      try {
        const chs = await sdk.getChains();
        setChains(Array.isArray(chs) ? chs : []);
      } catch {
        setChains([]);
      }

      // pick provider
      const supportsWallet = capabilities.includes('wallet.getEthereumProvider');
      let provider = null;

      // If we are in miniapp, prefer farcaster provider when available
      if (mini) {
        try {
          provider = await sdk.wallet.getEthereumProvider();
          setWalletMode('farcaster');
        } catch {
          provider = null;
        }
      }

      // fallback for browsers
      if (!provider && typeof window !== 'undefined') {
        provider = window.ethereum || null;
        if (provider) setWalletMode('browser');
      }

      setEthProvider(provider);
      if (provider) {
        attachProviderListeners(provider);
        await checkConnection(provider);
      }

      loadLeaderboard();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connectFarcasterWallet = async () => {
    try {
      setLoading(true);
      setStatus('Connecting Farcaster wallet...');
      const provider = await sdk.wallet.getEthereumProvider();
      setEthProvider(provider);
      setWalletMode('farcaster');
      attachProviderListeners(provider);

      const accounts = await providerRequest(provider, 'eth_requestAccounts');
      const addr = accounts?.[0] || null;
      setAccount(addr);

      await refreshChainId(provider);
      if (addr) loadFarcasterProfile(addr);

      setStatus(addr ? 'Farcaster wallet connected.' : 'Wallet connection failed.');
    } catch (err) {
      setStatus(`Connect failed: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const connectBrowserWallet = async () => {
    try {
      setLoading(true);
      setStatus('Connecting browser wallet...');
      const provider = typeof window !== 'undefined' ? window.ethereum : null;
      if (!provider?.request) throw new Error('No browser wallet found.');

      setEthProvider(provider);
      setWalletMode('browser');
      attachProviderListeners(provider);

      const accounts = await providerRequest(provider, 'eth_requestAccounts');
      const addr = accounts?.[0] || null;
      setAccount(addr);

      await refreshChainId(provider);
      if (addr) loadFarcasterProfile(addr);

      setStatus(addr ? 'Browser wallet connected.' : 'Wallet connection failed.');
    } catch (err) {
      setStatus(`Connect failed: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const switchChain = async (chainKey) => {
    const chain = CHAINS[chainKey];
    if (!ethProvider) throw new Error('No wallet provider');

    setStatus(`Switching to ${chain.name}...`);
    await providerRequest(ethProvider, 'wallet_switchEthereumChain', [{ chainId: chain.idHex }]);

    // confirm
    for (let i = 0; i < 10; i++) {
      const cid = await refreshChainId(ethProvider);
      if (cid === chain.idHex) return;
      await sleep(250);
    }
    throw new Error('Chain switch did not complete.');
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

    if (chainKey === 'hyperevm' && isMiniApp && !supportsHyperEvmInHost()) {
      setStatus('HyperEVM is not supported by this host wallet.');
      return;
    }

    const chain = CHAINS[chainKey];
    const valueHex = toHexWei(strikeWei[chainKey]); // ✅ now exact value

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
        value: valueHex,
        data: '0x'
      };

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
    <div className="min-h-screen bg-black p-4 relative overflow-hidden text-white">
      {isMiniApp && (
        <div className="fixed top-4 right-4 bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-bold z-50">
          FARCASTER
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

        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          {status && (
            <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700 text-center">
              <p className="text-white font-medium whitespace-pre-wrap">{status}</p>
            </div>
          )}

          <div className="mb-6">
            {!account ? (
              <div className="flex flex-col sm:flex-row gap-2">
                {isMiniApp && (
                  <button
                    onClick={connectFarcasterWallet}
                    disabled={loading}
                    className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2 border-2 border-purple-400"
                  >
                    <Wallet size={20} />
                    {loading ? 'Connecting...' : 'Connect Farcaster Wallet'}
                  </button>
                )}

                <button
                  onClick={connectBrowserWallet}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2 border-2 border-blue-400"
                >
                  <Wallet size={20} />
                  {loading ? 'Connecting...' : 'Connect Browser Wallet'}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-800 p-4 rounded-lg border border-gray-700">
                  <p className="text-gray-400 text-sm">Connected Wallet</p>
                  <p className="text-white font-mono text-sm">{shortAddr(account)}</p>
                  <p className="text-gray-400 text-sm mt-2">Chain ID</p>
                  <p className="text-white font-bold">{currentChainId || 'Unknown'}</p>
                  <p className="text-gray-500 text-xs mt-2">
                    Connected via: {walletMode || 'unknown'}
                  </p>
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

          <div className="grid md:grid-cols-2 gap-6">
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

            <div className="bg-gray-800 p-6 rounded-xl border-2 border-gray-700 hover:border-red-500 transition">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                  <Swords className="text-green-400" /> HyperEVM
                </h3>
                <span className="text-gray-400 text-sm">{strikeLabel('hyperevm')}</span>
              </div>

              <button
                onClick={() => sendTransaction('hyperevm')}
                disabled={!account || loading || (isMiniApp && !supportsHyperEvmInHost())}
                className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2 border-2 border-red-400"
              >
                {loading ? 'Striking...' : isMiniApp && !supportsHyperEvmInHost() ? 'Not supported in host' : 'Strike HyperEVM'}
              </button>
            </div>
          </div>

          {txHash && (
            <div className="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-600">
              <p className="text-gray-400 text-sm mb-1">Last Tx</p>
              <button
                onClick={() =>
                  openExplorer(currentChainId === CHAINS.base.idHex ? 'base' : 'hyperevm', txHash)
                }
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
