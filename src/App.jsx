import React, { useState, useEffect } from 'react';
import { Wallet, Send, ExternalLink, Trophy, Shield, Swords, Crown } from 'lucide-react';
import { sdk } from '@farcaster/miniapp-sdk';

// Backend URL
const BACKEND_URL =
  import.meta.env.VITE_BACKEND_URL || 'https://chainwarz-backend-production.up.railway.app';

const CHAINS = {
  base: {
    id: '0x2105',
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    contractAddress: '0xB2B23e69b9d811D3D43AD473f90A171D18b19aab',
    strikeAmount: '0.000001337 ETH',
    weiAmount: 1337000000000
  },
  hyperevm: {
    id: '0xd0d4',
    name: 'HyperEVM',
    rpcUrl: 'https://rpc.hyperliquid.xyz/evm',
    blockExplorer: 'https://explorer.hyperliquid.xyz',
    contractAddress: '0xDddED87c1f1487495E8aa47c9B43FEf4c5153054',
    strikeAmount: '0.000001337 HYPE',
    weiAmount: 1337000000000
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
    if (strikeCount >= RANKS[i].minStrikes) {
      return RANKS[i];
    }
  }
  return RANKS[0];
}

export default function App() {
  const [account, setAccount] = useState(null);
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [ethProvider, setEthProvider] = useState(null);

  const [farcasterProfile, setFarcasterProfile] = useState(null);
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [currentChain, setCurrentChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('game');
  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });

  // ----------------------------
  // Wallet provider selection
  // ----------------------------
  const getProvider = async (mini) => {
    if (mini) {
      // Farcaster/Warpcast wallet provider (EIP-1193)
      return await sdk.wallet.getEthereumProvider();
    }
    // Regular browser wallet provider (MetaMask, Coinbase Wallet, etc.)
    return typeof window !== 'undefined' ? window.ethereum : null;
  };

  const providerRequest = async (provider, method, params) => {
    if (!provider?.request) throw new Error('No EIP-1193 provider available');
    return provider.request({ method, params });
  };

  const attachProviderListeners = (provider) => {
    if (!provider?.on) return;

    provider.on('accountsChanged', (accounts) => {
      if (accounts?.length) {
        setAccount(accounts[0]);
        loadFarcasterProfile(accounts[0]);
      } else {
        setAccount(null);
        setFarcasterProfile(null);
      }
    });

    provider.on('chainChanged', () => {
      updateCurrentChain(provider);
    });
  };

  // ----------------------------
  // Init: detect Mini App + ready() + provider
  // ----------------------------
  useEffect(() => {
    const initApp = async () => {
      // 1) Detect Mini App context (official + reliable)
      let mini = false;
      try {
        mini = await sdk.isInMiniApp();
      } catch (e) {
        mini = false;
      }
      setIsMiniApp(mini);

      // 2) Dismiss Farcaster splash screen
      if (mini) {
        try {
          await sdk.actions.ready();
          console.log('SDK ready() called successfully');
        } catch (e) {
          console.error('ready() failed:', e);
        }
      }

      // 3) Choose the right wallet provider
      const provider = await getProvider(mini);
      setEthProvider(provider);

      // 4) Auto-check connection + attach listeners
      if (provider) {
        await checkConnection(provider);
        attachProviderListeners(provider);
      } else {
        console.warn('No wallet provider detected');
      }

      // 5) Load your existing data
      loadLeaderboard();
    };

    initApp();
  }, []);

  // ----------------------------
  // Backend calls
  // ----------------------------
  const loadFarcasterProfile = async (walletAddress) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/profile/${walletAddress}`);
      if (response.ok) {
        const data = await response.json();
        setFarcasterProfile(data);
      }
    } catch (error) {
      console.error('Error loading Farcaster profile:', error);
    }
  };

  const loadLeaderboard = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/leaderboard`);
      if (response.ok) {
        const data = await response.json();
        setLeaderboard(data);
      }
    } catch (error) {
      console.error('Error loading leaderboard:', error);
    }
  };

  // ----------------------------
  // Wallet / chain helpers
  // ----------------------------
  const checkConnection = async (providerParam) => {
    const provider = providerParam || ethProvider;
    if (!provider) return;

    try {
      const accounts = await providerRequest(provider, 'eth_accounts');
      if (accounts.length > 0) {
        setAccount(accounts[0]);
        await updateCurrentChain(provider);
        loadFarcasterProfile(accounts[0]);
      }
    } catch (err) {
      console.error('Error checking connection:', err);
    }
  };

  const updateCurrentChain = async (providerParam) => {
    const provider = providerParam || ethProvider;
    if (!provider) return;

    try {
      const chainId = await providerRequest(provider, 'eth_chainId');
      setCurrentChain(chainId);
    } catch (err) {
      console.error('Error getting chain:', err);
    }
  };

  const connectWallet = async () => {
    try {
      // If user clicks too quickly, provider might not be set yet. Grab it on-demand.
      let provider = ethProvider;
      if (!provider) {
        provider = await getProvider(isMiniApp);
        setEthProvider(provider);
      }

      if (!provider) {
        setStatus(isMiniApp ? 'No Farcaster wallet provider found' : 'Please install a Web3 wallet');
        return;
      }

      setLoading(true);
      setStatus(isMiniApp ? 'Connecting Farcaster wallet...' : 'Connecting wallet...');
      const accounts = await providerRequest(provider, 'eth_requestAccounts');
      setAccount(accounts[0]);
      await updateCurrentChain(provider);
      loadFarcasterProfile(accounts[0]);
      setStatus(isMiniApp ? 'Connected with Farcaster wallet!' : 'Wallet connected!');
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const switchChain = async (chainKey) => {
    const chain = CHAINS[chainKey];
    if (!ethProvider) throw new Error('No wallet provider');

    const nativeCurrency =
      chainKey === 'hyperevm'
        ? { name: 'HYPE', symbol: 'HYPE', decimals: 18 }
        : { name: 'Ether', symbol: 'ETH', decimals: 18 };

    try {
      setLoading(true);
      setStatus(`Switching to ${chain.name}...`);

      await providerRequest(ethProvider, 'wallet_switchEthereumChain', [{ chainId: chain.id }]);
      await updateCurrentChain(ethProvider);

      setStatus(`Now on ${chain.name}!`);
    } catch (err) {
      // 4902 = chain not added yet
      if (err?.code === 4902) {
        await providerRequest(ethProvider, 'wallet_addEthereumChain', [
          {
            chainId: chain.id,
            chainName: chain.name,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.blockExplorer],
            nativeCurrency
          }
        ]);
        await updateCurrentChain(ethProvider);
        setStatus(`Added + switched to ${chain.name}!`);
      } else {
        setStatus(`Error switching chain: ${err.message}`);
        throw err;
      }
    } finally {
      setLoading(false);
    }
  };

  const sendTransaction = async (chainKey) => {
    if (!account) {
      setStatus('Please connect your wallet first');
      return;
    }
    if (!ethProvider) {
      setStatus('No wallet provider available');
      return;
    }

    const chain = CHAINS[chainKey];

    try {
      setLoading(true);
      setTxHash('');

      setStatus(`Switching to ${chain.name}...`);
      await switchChain(chainKey);

      const currentChainId = await providerRequest(ethProvider, 'eth_chainId');
      if (currentChainId !== chain.id) {
        setStatus(`Failed to switch to ${chain.name}`);
        return;
      }

      setStatus('Confirm in wallet...');
      const hexValue = '0x' + chain.weiAmount.toString(16);

      const hash = await providerRequest(ethProvider, 'eth_sendTransaction', [
        {
          from: account,
          to: chain.contractAddress,
          value: hexValue
        }
      ]);

      setTxHash(hash);
      setStatus(`Transaction sent on ${chain.name}!`);

      // Refresh data after a short delay
      setTimeout(() => {
        loadLeaderboard();
        if (account) loadFarcasterProfile(account);
      }, 3000);
    } catch (err) {
      setStatus(`Transaction failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ----------------------------
  // UI helpers
  // ----------------------------
  const openExplorer = (chainKey, hash) => {
    const url = `${CHAINS[chainKey].blockExplorer}/tx/${hash}`;
    window.open(url, '_blank');
  };

  const totalStrikes =
    (farcasterProfile?.strikes?.base || 0) + (farcasterProfile?.strikes?.hyperevm || 0);
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
          <p className="text-gray-400 text-lg">Strike the chains. Climb the ranks. Dominate the leaderboard.</p>
        </div>

        {/* Tabs */}
        <div className="flex justify-center mb-6">
          <div className="bg-gray-900 rounded-lg p-1 flex">
            <button
              onClick={() => setActiveTab('game')}
              className={`px-6 py-2 rounded-md font-bold transition ${
                activeTab === 'game' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Swords className="inline mr-2" size={18} />
              Battle
            </button>
            <button
              onClick={() => setActiveTab('leaderboard')}
              className={`px-6 py-2 rounded-md font-bold transition ${
                activeTab === 'leaderboard' ? 'bg-yellow-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Trophy className="inline mr-2" size={18} />
              Leaderboard
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-gray-900 rounded-xl p-6 border border-gray-800">
          {/* Status Bar */}
          {status && (
            <div className="mb-4 p-3 bg-gray-800 rounded-lg border border-gray-700 text-center">
              <p className="text-white font-medium">{status}</p>
            </div>
          )}

          {/* Wallet Section */}
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
                  <p className="text-gray-400 text-sm mt-2">Chain</p>
                  <p className="text-white font-bold">
                    {currentChain === CHAINS.base.id
                      ? 'Base'
                      : currentChain === CHAINS.hyperevm.id
                      ? 'HyperEVM'
                      : currentChain || 'Unknown'}
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

          {activeTab === 'game' ? (
            <div className="grid md:grid-cols-2 gap-6">
              {Object.entries(CHAINS).map(([chainKey, chain]) => (
                <div
                  key={chainKey}
                  className="bg-gray-800 p-6 rounded-xl border-2 border-gray-700 hover:border-red-500 transition"
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-2xl font-bold text-white flex items-center gap-2">
                      <Shield className={chainKey === 'base' ? 'text-blue-400' : 'text-purple-400'} />
                      {chain.name}
                    </h3>
                    <span className="text-gray-400 text-sm">{chain.strikeAmount}</span>
                  </div>

                  <button
                    onClick={() => sendTransaction(chainKey)}
                    disabled={!account || loading}
                    className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg transition flex items-center justify-center gap-2 border-2 border-red-400"
                  >
                    <Send size={20} />
                    {loading ? 'Striking...' : `Strike ${chain.name}`}
                  </button>

                  {txHash && (
                    <div className="mt-4 p-3 bg-gray-900 rounded-lg border border-gray-600">
                      <p className="text-gray-400 text-sm mb-1">Last Strike</p>
                      <button
                        onClick={() => openExplorer(chainKey, txHash)}
                        className="text-blue-400 hover:text-blue-300 text-sm font-mono flex items-center gap-1"
                      >
                        {txHash.slice(0, 10)}...{txHash.slice(-8)}
                        <ExternalLink size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(leaderboard).map(([chainKey, players]) => (
                <div key={chainKey} className="bg-gray-800 p-6 rounded-xl border border-gray-700">
                  <h3 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                    <Trophy className={chainKey === 'base' ? 'text-blue-400' : 'text-purple-400'} />
                    {chainKey === 'base' ? 'Base' : 'HyperEVM'} Leaderboard
                  </h3>

                  <div className="space-y-3">
                    {players.map((player, index) => (
                      <div
                        key={player.walletAddress}
                        className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-600"
                      >
                        <div className="flex items-center gap-4">
                          <div className="text-2xl font-bold text-yellow-400">#{index + 1}</div>
                          <div>
                            <p className="text-white font-bold">@{player.username || 'Unknown'}</p>
                            <p className="text-gray-400 text-sm font-mono">
                              {player.walletAddress.slice(0, 6)}...{player.walletAddress.slice(-4)}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-gray-400 text-sm">Strikes</p>
                          <div className="text-lg font-bold text-green-400">{player.txCount}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
