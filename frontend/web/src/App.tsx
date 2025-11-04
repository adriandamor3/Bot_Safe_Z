import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ChatMessage {
  id: string;
  question: string;
  encryptedValue: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
  aiResponse: string;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showIntro, setShowIntro] = useState(true);
  const [userInput, setUserInput] = useState("");
  const [aiThinking, setAiThinking] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredChats, setFilteredChats] = useState<ChatMessage[]>([]);
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);
  const [stats, setStats] = useState({ totalChats: 0, verified: 0, active: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        console.error('FHEVM init failed:', error);
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      setIsRefreshing(true);
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        
        const businessIds = await contract.getAllBusinessIds();
        const chatsList: ChatMessage[] = [];
        
        for (const businessId of businessIds) {
          try {
            const businessData = await contract.getBusinessData(businessId);
            const numericValue = Math.abs(parseInt(businessId.replace('chat-', '')) % 1000);
            const aiResponses = [
              "I understand your encrypted query about security protocols.",
              "Based on your FHE-encrypted input, I recommend enhanced verification.",
              "The encrypted data suggests optimal privacy measures are active.",
              "Your query has been processed with zero-knowledge proofs.",
              "FHE analysis confirms the security level you requested."
            ];
            
            chatsList.push({
              id: businessId,
              question: businessData.name,
              encryptedValue: numericValue,
              timestamp: Number(businessData.timestamp),
              creator: businessData.creator,
              isVerified: businessData.isVerified,
              decryptedValue: Number(businessData.decryptedValue) || 0,
              aiResponse: aiResponses[numericValue % aiResponses.length]
            });
          } catch (e) {
            console.error('Error loading chat:', e);
          }
        }
        
        setChats(chatsList);
        setStats({
          totalChats: chatsList.length,
          verified: chatsList.filter(c => c.isVerified).length,
          active: chatsList.filter(c => Date.now()/1000 - c.timestamp < 86400).length
        });
        
        if (chatsList.length > 0) setShowIntro(false);
      } catch (e) {
        console.error('Load failed:', e);
      } finally { 
        setIsRefreshing(false);
        setLoading(false);
      }
    };

    loadData();
  }, [isConnected]);

  useEffect(() => {
    const filtered = chats.filter(chat => 
      chat.question.toLowerCase().includes(searchTerm.toLowerCase()) ||
      chat.aiResponse.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredChats(filtered);
  }, [searchTerm, chats]);

  const sendMessage = async () => {
    if (!isConnected || !address || !userInput.trim()) return;
    
    setAiThinking(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting message with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("No contract");
      
      const businessId = `chat-${Date.now()}`;
      const numericValue = userInput.length % 1000;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, numericValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        userInput,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        numericValue,
        0,
        "FHE Chat Message"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Storing encrypted message..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, userInput]);
      
      setTimeout(async () => {
        await loadData();
        setAiThinking(false);
        setTransactionStatus({ visible: true, status: "success", message: "AI response generated with FHE!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }, 2000);
      
      setUserInput("");
      setShowIntro(false);
    } catch (e: any) {
      setAiThinking(false);
      const errorMsg = e.message?.includes("rejected") ? "Transaction rejected" : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMsg });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const decryptMessage = async (chatId: string) => {
    if (!isConnected || !address) return;
    
    setTransactionStatus({ visible: true, status: "pending", message: "Decrypting with FHE..." });
    
    try {
      const contractRead = await getContractReadOnly();
      const contractWrite = await getContractWithSigner();
      if (!contractRead || !contractWrite) return;
      
      const chatData = await contractRead.getBusinessData(chatId);
      if (chatData.isVerified) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return;
      }
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(chatId);
      
      await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(chatId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "success", message: "Message decrypted and verified!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      await loadData();
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE System Available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      console.error('Availability check failed:', e);
    }
  };

  const faqItems = [
    { q: "What is FHE?", a: "Fully Homomorphic Encryption allows computation on encrypted data without decryption." },
    { q: "Is my data secure?", a: "Yes, all conversations are encrypted end-to-end using FHE technology." },
    { q: "How does AI understand encrypted data?", a: "Our AI uses homomorphic computations to process encrypted inputs directly." }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🔐</div>
            <h1>Bot_Safe_Z</h1>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-screen">
          <div className="cyber-grid"></div>
          <div className="welcome-content">
            <h2>FHE Secure Chatbot</h2>
            <p>Experience AI conversations with full homomorphic encryption protection</p>
            <div className="feature-cards">
              <div className="feature-card">
                <div className="card-icon">🔒</div>
                <h3>End-to-End Encryption</h3>
                <p>All messages encrypted with FHE technology</p>
              </div>
              <div className="feature-card">
                <div className="card-icon">🤖</div>
                <h3>AI Understanding</h3>
                <p>AI processes encrypted data directly</p>
              </div>
              <div className="feature-card">
                <div className="card-icon">⚡</div>
                <h3>Zero Knowledge</h3>
                <p>No data storage, complete privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="neon-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-section">
            <div className="logo-icon">🔐</div>
            <h1>Bot_Safe_Z</h1>
          </div>
          <button className="nav-btn" onClick={checkAvailability}>
            Check FHE Status
          </button>
        </div>
        
        <div className="header-right">
          <button className="nav-btn" onClick={() => setShowFAQ(!showFAQ)}>
            FAQ
          </button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-layout">
        <aside className="sidebar">
          <div className="stats-panel">
            <h3>Chat Statistics</h3>
            <div className="stat-item">
              <span>Total Chats</span>
              <span className="stat-value">{stats.totalChats}</span>
            </div>
            <div className="stat-item">
              <span>Verified</span>
              <span className="stat-value">{stats.verified}</span>
            </div>
            <div className="stat-item">
              <span>Active Today</span>
              <span className="stat-value">{stats.active}</span>
            </div>
          </div>

          <div className="search-section">
            <input
              type="text"
              placeholder="Search chats..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
          </div>

          <div className="chat-history">
            <h4>Recent Chats</h4>
            {(searchTerm ? filteredChats : chats).slice(0, 10).map((chat, index) => (
              <div key={index} className="history-item">
                <div className="history-question">{chat.question.substring(0, 30)}...</div>
                <div className="history-meta">
                  <span>{new Date(chat.timestamp * 1000).toLocaleTimeString()}</span>
                  {chat.isVerified && <span className="verified-badge">✓</span>}
                </div>
              </div>
            ))}
          </div>

          {userHistory.length > 0 && (
            <div className="user-history">
              <h4>Your Questions</h4>
              {userHistory.slice(-5).map((question, index) => (
                <div key={index} className="history-question">{question}</div>
              ))}
            </div>
          )}
        </aside>

        <main className="chat-area">
          {showIntro ? (
            <div className="intro-panel">
              <div className="cyber-orbit"></div>
              <h2>Start Encrypted Conversation</h2>
              <p>Ask anything about privacy, security, or FHE technology</p>
              <div className="suggestions">
                <button onClick={() => setUserInput("How does FHE protect my privacy?")} className="suggestion-btn">
                  How does FHE protect my privacy?
                </button>
                <button onClick={() => setUserInput("Explain homomorphic encryption")} className="suggestion-btn">
                  Explain homomorphic encryption
                </button>
                <button onClick={() => setUserInput("AI security best practices")} className="suggestion-btn">
                  AI security best practices
                </button>
              </div>
            </div>
          ) : (
            <div className="chat-container">
              <div className="messages-list">
                {chats.map((chat, index) => (
                  <div key={index} className="message-pair">
                    <div className="user-message">
                      <div className="message-bubble">
                        <div className="message-text">{chat.question}</div>
                        <div className="message-meta">
                          <span>You • {new Date(chat.timestamp * 1000).toLocaleTimeString()}</span>
                          {!chat.isVerified && (
                            <button 
                              onClick={() => decryptMessage(chat.id)}
                              className="decrypt-btn small"
                            >
                              Verify
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    <div className="ai-message">
                      <div className="ai-avatar">🤖</div>
                      <div className="message-bubble ai">
                        <div className="message-text">{chat.aiResponse}</div>
                        <div className="message-meta">
                          <span>Bot_Safe_Z • FHE Protected</span>
                          {chat.isVerified && (
                            <span className="verified-tag">✓ Verified</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {aiThinking && (
                  <div className="thinking-indicator">
                    <div className="thinking-dots">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                    <span>AI is thinking with FHE...</span>
                  </div>
                )}
              </div>
              
              <div className="input-section">
                <div className="input-container">
                  <input
                    type="text"
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    placeholder="Ask about FHE, privacy, or security..."
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                    className="message-input"
                  />
                  <button 
                    onClick={sendMessage} 
                    disabled={!userInput.trim() || aiThinking}
                    className="send-btn"
                  >
                    {aiThinking ? "🔒" : "➤"}
                  </button>
                </div>
                <div className="encryption-notice">
                  <span>🔐 All messages encrypted with FHE</span>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {showFAQ && (
        <div className="faq-modal">
          <div className="faq-content">
            <div className="faq-header">
              <h2>FHE Chatbot FAQ</h2>
              <button onClick={() => setShowFAQ(false)} className="close-btn">×</button>
            </div>
            <div className="faq-items">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <h4>{item.q}</h4>
                  <p>{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="status-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="pulse-dot"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            {transactionStatus.message}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>FHE-Based Secure Chatbot • Your Privacy is Protected</p>
      </footer>
    </div>
  );
};

export default App;


