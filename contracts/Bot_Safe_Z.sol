pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract BotSafeZ is ZamaEthereumConfig {
    
    struct ChatSession {
        address user;
        euint32 encryptedMessage;
        uint256 timestamp;
        bool isProcessed;
        uint32 decryptedResponse;
    }
    
    mapping(uint256 => ChatSession) public sessions;
    uint256 public sessionCount;
    
    event MessageSent(uint256 indexed sessionId, address indexed user);
    event ResponseGenerated(uint256 indexed sessionId, uint32 response);
    
    constructor() ZamaEthereumConfig() {
        sessionCount = 0;
    }
    
    function sendMessage(
        externalEuint32 encryptedMessage,
        bytes calldata inputProof
    ) external {
        require(FHE.isInitialized(FHE.fromExternal(encryptedMessage, inputProof)), "Invalid encrypted input");
        
        uint256 sessionId = sessionCount++;
        sessions[sessionId] = ChatSession({
            user: msg.sender,
            encryptedMessage: FHE.fromExternal(encryptedMessage, inputProof),
            timestamp: block.timestamp,
            isProcessed: false,
            decryptedResponse: 0
        });
        
        FHE.allowThis(sessions[sessionId].encryptedMessage);
        FHE.makePubliclyDecryptable(sessions[sessionId].encryptedMessage);
        
        emit MessageSent(sessionId, msg.sender);
    }
    
    function processMessage(
        uint256 sessionId,
        bytes memory abiEncodedResponse,
        bytes memory decryptionProof
    ) external {
        require(sessionId < sessionCount, "Invalid session ID");
        require(!sessions[sessionId].isProcessed, "Message already processed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(sessions[sessionId].encryptedMessage);
        
        FHE.checkSignatures(cts, abiEncodedResponse, decryptionProof);
        
        uint32 decodedResponse = abi.decode(abiEncodedResponse, (uint32));
        
        sessions[sessionId].decryptedResponse = decodedResponse;
        sessions[sessionId].isProcessed = true;
        
        emit ResponseGenerated(sessionId, decodedResponse);
    }
    
    function getEncryptedMessage(uint256 sessionId) external view returns (euint32) {
        require(sessionId < sessionCount, "Invalid session ID");
        return sessions[sessionId].encryptedMessage;
    }
    
    function getSession(uint256 sessionId) external view returns (
        address user,
        uint256 timestamp,
        bool isProcessed,
        uint32 decryptedResponse
    ) {
        require(sessionId < sessionCount, "Invalid session ID");
        ChatSession storage session = sessions[sessionId];
        
        return (
            session.user,
            session.timestamp,
            session.isProcessed,
            session.decryptedResponse
        );
    }
    
    function getSessionCount() external view returns (uint256) {
        return sessionCount;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


