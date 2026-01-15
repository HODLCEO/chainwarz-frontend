import React, { useState, useEffect } from 'react';
import { Wallet, Send, ExternalLink, Trophy, Shield, Swords, Crown } from 'lucide-react';

// Farcaster Frame SDK detection and initialization
const isFarcaster = typeof window !== 'undefined' && window.ethereum?.isFarcaster;

// Initialize Farcaster SDK if in frame
if (typeof window !== 'undefined' && window.parent !== window) {
  // We're in an iframe (Farcaster context)
  try {
    if (window.sdk) {
      window.sdk.actions.ready();
    }
  } catch (e) {
    console.log('Not in Farcaster frame context');
  }
}

const CHAINS = {
  base: {
    id: '0x2105',
    name: 'Base',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
    contractAddress: '0xd4142119673975d18D49203702A73a6b6938A7D1'
  },
  hyperevm: {
    id: '0x3e7',
    name: 'HyperEVM',
    rpcUrl: 'https://api.hyperliquid-testnet.xyz/evm',
    blockExplorer: 'https://hyperevmscan.io',
    contractAddress: '0x044A0B2D6eF67F5B82e51ec7229D84C0e83C8f02'
  }
};

const RANKS = [
  { name: 'Squire', minStrikes: 0, icon: '🛡️', color: 'text-gray-400' },
  { name: 'Knight', minStrikes: 100, icon: '⚔️', color: 'text-blue-400' },
  { name: 'Knight Captain', minStrikes: 250, icon: '🗡️', color: 'text-purple-400' },
  { name: 'Baron', minStrikes: 500, icon: '🎖️', color: 'text-yellow-400' },
  { name: 'Duke', minStrikes: 1000, icon: '👑', color: 'text-orange-400' },
  { name: 'Warlord', minStrikes: 2500, icon: '⚜️', color: 'text-red-400' },
  { name: 'Legendary Champion', minStrikes: 5000, icon: '🔥', color: 'text-pink-400' }
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
  const [farcasterProfile, setFarcasterProfile] = useState(null);
  const [status, setStatus] = useState('');
  const [txHash, setTxHash] = useState('');
  const [currentChain, setCurrentChain] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('game');
  const [leaderboard, setLeaderboard] = useState({ base: [], hyperevm: [] });

  useEffect(() => {
    // Initialize Farcaster SDK
    const initFarcaster = () => {
      if (window.parent !== window && window.sdk) {
        try {
          window.sdk.actions.ready();
          console.log('Farcaster SDK initialized');
        } catch (e) {
          console.error('Error initializing Farcaster SDK:', e);
        }
      }
    };

    // Wait for SDK to load
    if (window.sdk) {
      initFarcaster();
    } else {
      window.addEventListener('load', initFarcaster);
    }

    checkConnection();
    loadLeaderboard();

    return () => {
      window.removeEventListener('load', initFarcaster);
    };
  }, []);

  const checkConnection = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const accounts = await window.ethereum.request({ method: 'eth_accounts' });
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          updateCurrentChain();
          loadFarcasterProfile(accounts[0]);
        }
      } catch (err) {
        console.error('Error checking connection:', err);
      }
    }
  };

  const updateCurrentChain = async () => {
    if (typeof window.ethereum !== 'undefined') {
      try {
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        setCurrentChain(chainId);
      } catch (err) {
        console.error('Error getting chain:', err);
      }
    }
  };

  const loadFarcasterProfile = async (address) => {
    try {
      const res = await fetch(`http://localhost:3001/api/profile/${address}`);
      const data = await res.json();
      setFarcasterProfile(data);
    } catch (error) {
      console.error('Error loading profile:', error);
      setFarcasterProfile({
        username: 'knight_' + address.substring(2, 8),
        displayName: 'Castle Warrior',
        bio: 'Defending the realm in the multi-chain wars',
        pfpUrl: 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + address,
        fid: '12345',
        txCount: { base: 0, hyperevm: 0 }
      });
    }
  };

  const loadLeaderboard = async () => {
    try {
      const baseRes = await fetch('http://localhost:3001/api/leaderboard/base');
      const hyperevmRes = await fetch('http://localhost:3001/api/leaderboard/hyperevm');
      const baseData = await baseRes.json();
      const hyperevmData = await hyperevmRes.json();
      setLeaderboard({ base: baseData, hyperevm: hyperevmData });
    } catch (error) {
      console.error('Error loading leaderboard:', error);
    }
  };

  const connectWallet = async () => {
    if (isFarcaster) {
      try {
        setLoading(true);
        setStatus('Connecting with Farcaster wallet...');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        setAccount(accounts[0]);
        setStatus('Connected with Farcaster! ⚔️');
        updateCurrentChain();
        loadFarcasterProfile(accounts[0]);
        window.ethereum.on('accountsChanged', (accounts) => {
          if (accounts.length > 0) {
            setAccount(accounts[0]);
            loadFarcasterProfile(accounts[0]);
          } else {
            setAccount(null);
            setFarcasterProfile(null);
          }
        });
        window.ethereum.on('chainChanged', () => updateCurrentChain());
      } catch (err) {
        setStatus(`Error: ${err.message}`);
      } finally {
        setLoading(false);
      }
      return;
    }
    
    if (typeof window.ethereum === 'undefined') {
      setStatus('Please install a Web3 wallet or open in Farcaster app');
      return;
    }

    try {
      setLoading(true);
      setStatus('Summoning your wallet...');
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      setAccount(accounts[0]);
      setStatus('Connected successfully!');
      updateCurrentChain();
      loadFarcasterProfile(accounts[0]);
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          loadFarcasterProfile(accounts[0]);
        } else {
          setAccount(null);
          setFarcasterProfile(null);
        }
      });
      window.ethereum.on('chainChanged', () => updateCurrentChain());
    } catch (err) {
      setStatus(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const switchChain = async (chainKey) => {
    const chain = CHAINS[chainKey];
    try {
      setLoading(true);
      setStatus(`Traveling to ${chain.name}...`);
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chain.id }],
      });
      await new Promise(resolve => setTimeout(resolve, 500));
      await updateCurrentChain();
      setStatus(`Arrived at ${chain.name}!`);
    } catch (err) {
      if (err.code === 4902) {
        try {
          await window.ethereum.request({
            method: 'wallet_addEthereumChain',
            params: [{
              chainId: chain.id,
              chainName: chain.name,
              rpcUrls: [chain.rpcUrl],
              blockExplorerUrls: [chain.blockExplorer],
              nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }
            }],
          });
          await new Promise(resolve => setTimeout(resolve, 500));
          await updateCurrentChain();
          setStatus(`Discovered and traveled to ${chain.name}!`);
        } catch (addErr) {
          setStatus(`Error adding chain: ${addErr.message}`);
          throw addErr;
        }
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

    const chain = CHAINS[chainKey];
    try {
      setLoading(true);
      setTxHash('');
      setStatus(`Traveling to ${chain.name}...`);
      await switchChain(chainKey);
      
      const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
      if (currentChainId !== chain.id) {
        setStatus(`Failed to travel to ${chain.name}`);
        setLoading(false);
        return;
      }
      
      setStatus(`Preparing attack on ${chain.name}...`);
      let weiAmount = chainKey === 'hyperevm' ? 133700000000000 : 1337000000000;
      const hexValue = '0x' + weiAmount.toString(16);
      
      const txParams = {
        from: account,
        to: chain.contractAddress,
        value: hexValue
      };
      
      setStatus(`Confirm the attack in your wallet...`);
      const hash = await window.ethereum.request({
        method: 'eth_sendTransaction',
        params: [txParams],
      });
      
      setTxHash(hash);
      setStatus(`⚔️ Strike successful on ${chain.name}! Victory is yours!`);
      setTimeout(() => {
        loadLeaderboard();
        if (account) loadFarcasterProfile(account);
      }, 3000);
    } catch (err) {
      setStatus(`Battle failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getChainName = (chainId) => {
    if (!chainId) return 'Unknown Realm';
    const chain = Object.values(CHAINS).find(c => c.id === chainId);
    return chain ? chain.name : `Realm ${parseInt(chainId, 16)}`;
  };

  const getExplorerUrl = (chainKey, hash) => {
    return `${CHAINS[chainKey].blockExplorer}/tx/${hash}`;
  };

  const totalStrikes = farcasterProfile ? farcasterProfile.txCount.base + farcasterProfile.txCount.hyperevm : 0;
  const currentRank = getRank(totalStrikes);

  return (
    <div className="min-h-screen bg-black p-4 relative overflow-hidden">
      {isFarcaster && (
        <div className="fixed top-4 right-4 bg-purple-600 text-white px-3 py-1 rounded-full text-xs font-bold z-50 flex items-center gap-2">
          <span>🟣</span> Farcaster
        </div>
      )}
      
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-10 left-10 text-6xl">🏰</div>
        <div className="absolute top-20 right-20 text-5xl">⚔️</div>
        <div className="absolute bottom-20 left-20 text-5xl">🛡️</div>
        <div className="absolute bottom-10 right-10 text-6xl">👑</div>
      </div>
      
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="bg-gradient-to-b from-gray-900 to-black rounded-2xl shadow-2xl overflow-hidden border-4 border-gray-800">
          <div className="bg-gradient-to-r from-gray-800 via-gray-900 to-gray-800 p-6 text-white relative border-b-4 border-gray-700">
            <div className="flex items-center justify-center gap-3 mb-2">
              <Shield size={40} className="text-gray-400" />
              <h1 className="text-4xl font-bold text-center">Chain WarZ</h1>
              <Swords size={40} className="text-gray-400" />
            </div>
            <p className="text-gray-400 text-center">⚔️ Battle for supremacy across the kingdoms ⚔️</p>
          </div>

          <div className="bg-black border-b-4 border-gray-800 flex">
            <button onClick={() => setActiveTab('game')} className={`flex-1 py-3 px-6 font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'game' ? 'bg-gray-900 text-white border-b-4 border-gray-600' : 'text-gray-600 hover:text-gray-400'}`}>
              <Swords size={20} /> Battle Arena
            </button>
            <button onClick={() => setActiveTab('profile')} className={`flex-1 py-3 px-6 font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'profile' ? 'bg-gray-900 text-white border-b-4 border-gray-600' : 'text-gray-600 hover:text-gray-400'}`}>
              <Shield size={20} /> Knight Profile
            </button>
            <button onClick={() => setActiveTab('leaderboard')} className={`flex-1 py-3 px-6 font-bold transition-all flex items-center justify-center gap-2 ${activeTab === 'leaderboard' ? 'bg-gray-900 text-white border-b-4 border-gray-600' : 'text-gray-600 hover:text-gray-400'}`}>
              <Crown size={20} /> Hall of Fame
            </button>
          </div>

          <div className="p-6 bg-black">
            {activeTab === 'game' && (
              <div className="space-y-6">
                <div className="bg-gray-900 rounded-xl p-4 border-2 border-gray-800">
                  {!account ? (
                    <button onClick={connectWallet} disabled={loading} className="w-full bg-gradient-to-r from-gray-700 to-gray-800 text-white py-3 px-6 rounded-lg font-bold flex items-center justify-center gap-2 hover:from-gray-600 hover:to-gray-700 transition-all disabled:opacity-50 border-2 border-gray-600">
                      <Wallet size={20} />
                      {loading ? 'Connecting...' : isFarcaster ? 'Connect Farcaster Wallet' : 'Connect Wallet'}
                    </button>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-xs text-gray-400 block mb-1 font-semibold">⚔️ Knight</span>
                        <span className="text-sm font-mono bg-black px-3 py-1 rounded text-gray-300 block border border-gray-800">
                          {account.substring(0, 6)}...{account.substring(38)}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block mb-1 font-semibold">🏰 Current Realm</span>
                        <span className="text-sm font-bold text-gray-300 bg-black px-3 py-1 rounded block text-center border border-gray-800">
                          {getChainName(currentChain)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {status && (
                  <div className="bg-gray-900 border-2 border-gray-700 rounded-lg p-4">
                    <p className="text-sm text-gray-300">{status}</p>
                  </div>
                )}

                {txHash && (
                  <div className="bg-green-900 border-2 border-green-700 rounded-lg p-4">
                    <p className="text-sm text-green-200 font-bold mb-2">⚔️ Victory Achieved!</p>
                    <a href={getExplorerUrl(currentChain === CHAINS.base.id ? 'base' : 'hyperevm', txHash)} target="_blank" rel="noopener noreferrer" className="text-xs bg-black px-2 py-1 rounded border border-green-700 text-green-300 hover:text-white inline-flex items-center gap-1">
                      {txHash.substring(0, 20)}... <ExternalLink size={12} />
                    </a>
                  </div>
                )}

                {account && (
                  <div className="space-y-4">
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Swords size={24} /> Choose Your Battlefield
                    </h2>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <button onClick={() => sendTransaction('base')} disabled={loading} className="bg-gradient-to-br from-blue-700 to-blue-900 text-white py-8 px-6 rounded-lg font-bold flex flex-col items-center justify-center gap-3 hover:from-blue-600 hover:to-blue-800 transition-all disabled:opacity-50 border-4 border-blue-600 relative overflow-hidden group">
                        <div className="absolute inset-0 bg-blue-400 opacity-0 group-hover:opacity-20 transition-opacity"></div>
                        <Shield size={32} className="text-blue-300" />
                        <span className="text-2xl">Fight for Base</span>
                        <span className="text-xs opacity-75">⚔️ Send 0.000001337 ETH</span>
                      </button>
                      
                      <button onClick={() => sendTransaction('hyperevm')} disabled={loading} className="bg-gradient-to-br from-green-700 to-green-900 text-white py-8 px-6 rounded-lg font-bold flex flex-col items-center justify-center gap-3 hover:from-green-600 hover:to-green-800 transition-all disabled:opacity-50 border-4 border-green-600 relative overflow-hidden group">
                        <div className="absolute inset-0 bg-green-400 opacity-0 group-hover:opacity-20 transition-opacity"></div>
                        <Swords size={32} className="text-green-300" />
                        <span className="text-2xl">Fight for Hyperliquid</span>
                        <span className="text-xs opacity-75">⚔️ Send 0.0001337 HYPE</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="space-y-6">
                {!account ? (
                  <div className="text-center py-12">
                    <Shield size={64} className="mx-auto text-gray-600 mb-4" />
                    <p className="text-gray-400 mb-4 text-lg">Connect your wallet to view your knight profile</p>
                    <button onClick={connectWallet} className="bg-gradient-to-r from-gray-700 to-gray-800 text-white py-3 px-8 rounded-lg font-bold hover:from-gray-600 hover:to-gray-700 transition-all border-2 border-gray-600">
                      Connect Wallet
                    </button>
                  </div>
                ) : farcasterProfile ? (
                  <div className="max-w-2xl mx-auto">
                    <div className="bg-gray-900 rounded-xl p-6 border-4 border-gray-800">
                      <div className="flex items-start gap-4 mb-6">
                        <img src={farcasterProfile.pfpUrl} alt="Profile" className="w-24 h-24 rounded-full border-4 border-gray-700" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-3xl ${currentRank.color}`}>{currentRank.icon}</span>
                            <div>
                              <h3 className={`text-lg font-bold ${currentRank.color}`}>{currentRank.name}</h3>
                              <h2 className="text-2xl font-bold text-white">{farcasterProfile.displayName}</h2>
                            </div>
                          </div>
                          <a href={`https://warpcast.com/${farcasterProfile.username}`} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-300 flex items-center gap-1 mb-2">
                            @{farcasterProfile.username} <ExternalLink size={14} />
                          </a>
                          <p className="text-gray-500 text-sm">{farcasterProfile.bio}</p>
                        </div>
                      </div>
                      
                      <div className="mb-6 p-4 bg-black rounded-lg border-2 border-gray-800">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-gray-400 text-sm">Total Strikes</span>
                          <span className="text-2xl font-bold text-white">{totalStrikes}</span>
                        </div>
                        {RANKS.findIndex(r => r.name === currentRank.name) < RANKS.length - 1 && (
                          <div>
                            <div className="flex justify-between text-xs text-gray-500 mb-1">
                              <span>Next: {RANKS[RANKS.findIndex(r => r.name === currentRank.name) + 1].name}</span>
                              <span>{RANKS[RANKS.findIndex(r => r.name === currentRank.name) + 1].minStrikes - totalStrikes} to go</span>
                            </div>
                            <div className="w-full bg-gray-800 rounded-full h-2">
                              <div className="bg-gradient-to-r from-blue-500 to-green-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(100, ((totalStrikes - currentRank.minStrikes) / (RANKS[RANKS.findIndex(r => r.name === currentRank.name) + 1].minStrikes - currentRank.minStrikes)) * 100)}%` }}></div>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 pt-6 border-t-2 border-gray-800">
                        <div className="bg-gradient-to-br from-blue-900 to-blue-950 rounded-lg p-4 border-2 border-blue-800">
                          <div className="text-3xl font-bold text-blue-400 mb-1">{farcasterProfile.txCount.base}</div>
                          <div className="text-sm text-blue-300">🛡️ Base Kingdom Battles</div>
                        </div>
                        <div className="bg-gradient-to-br from-green-900 to-green-950 rounded-lg p-4 border-2 border-green-800">
                          <div className="text-3xl font-bold text-green-400 mb-1">{farcasterProfile.txCount.hyperevm}</div>
                          <div className="text-sm text-green-300">⚔️ Hyperliquid Battles</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {activeTab === 'leaderboard' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold text-blue-400 mb-4 flex items-center gap-2">
                    <Crown size={24} className="text-gray-500" /> Base Kingdom Warriors
                  </h2>
                  <div className="bg-gray-900 rounded-xl border-2 border-blue-800 overflow-hidden">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      {leaderboard.base.map((player, idx) => {
                        const playerRank = getRank(player.txCount);
                        return (
                          <div key={idx} className={`flex items-center gap-3 p-3 border-b border-r border-gray-800 ${idx < 3 ? 'bg-gradient-to-br from-blue-900 to-blue-950' : 'bg-gray-900'}`}>
                            <div className="w-8 text-center font-bold text-gray-400 text-lg">
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : player.rank}
                            </div>
                            <img src={player.pfpUrl} alt={player.username} className="w-10 h-10 rounded-full border-2 border-blue-600" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-xs">{playerRank.icon}</span>
                                <div className="text-sm font-bold text-blue-200 truncate">{player.username}</div>
                              </div>
                              <div className="text-lg font-bold text-blue-400">{player.txCount}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-xl font-bold text-green-400 mb-4 flex items-center gap-2">
                    <Crown size={24} className="text-gray-500" /> Hyperliquid Legends
                  </h2>
                  <div className="bg-gray-900 rounded-xl border-2 border-green-800 overflow-hidden">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                      {leaderboard.hyperevm.map((player, idx) => {
                        const playerRank = getRank(player.txCount);
                        return (
                          <div key={idx} className={`flex items-center gap-3 p-3 border-b border-r border-gray-800 ${idx < 3 ? 'bg-gradient-to-br from-green-900 to-green-950' : 'bg-gray-900'}`}>
                            <div className="w-8 text-center font-bold text-gray-400 text-lg">
                              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : player.rank}
                            </div>
                            <img src={player.pfpUrl} alt={player.username} className="w-10 h-10 rounded-full border-2 border-green-600" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-xs">{playerRank.icon}</span>
                                <div className="text-sm font-bold text-green-200 truncate">{player.username}</div>
                              </div>
                              <div className="text-lg font-bold text-green-400">{player.txCount}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}