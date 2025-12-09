// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Router} from "@hyperlane-xyz/core/contracts/client/Router.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title PrivateTransferIngress
 * @notice Runs on Mantle Sepolia. Accepts encrypted instructions and forwards
 *         them to the Sapphire PrivateTransferVault over Hyperlane.
 */
contract PrivateTransferIngress is Router {
    using SafeERC20 for IERC20;

    struct TransferMetadata {
        address sender;
        uint32 destinationDomain;
        uint256 dispatchedAt;
        bool acknowledged;
    }

    struct Deposit {
        address depositor;
        address token;
        uint256 amount; // remaining balance for this depositId
        bool isNative;
        bool released;
    }

    uint256 private _nonce;
    mapping(bytes32 => TransferMetadata) public transfers;
    mapping(bytes32 => Deposit) public deposits;
    mapping(bytes32 => bytes32) public transferIdToCiphertextHash; // Store ciphertext hash for Umbra-like pattern
    mapping(bytes32 => bytes32) public ciphertextHashToTransferId; // Reverse lookup to aid tracking
    mapping(bytes32 => bytes32) public transferToDepositId; // Map transferId -> depositId

    /**
     * @notice Emitted when a deposit is created (separate from transfer).
     * @dev This allows amount to be hidden from transfer initiation call data.
     */
    event DepositCreated(
        bytes32 indexed depositId,
        address indexed depositor,
        address token,
        uint256 amount,
        bool isNative
    );

    /**
     * @notice Emitted when encrypted instructions are received (like Umbra).
     * @dev Only emits encrypted data hash - minimal on-chain footprint.
     *      This makes the transaction look like encrypted instructions, not a transfer.
     *      Persis seperti Umbra: hanya encrypted instructions yang terlihat di public chain.
     */
    event EncryptedInstructionsReceived(
        bytes32 indexed encryptedDataHash
    );

    /**
     * @notice Emitted when encrypted instructions are processed (like Umbra).
     * @dev Only emits encrypted data hash - minimal footprint.
     *      Computation terjadi di Oasis (confidential), seperti Umbra di Arcium.
     */
    event EncryptedInstructionsProcessed(
        bytes32 indexed encryptedDataHash
    );

    constructor(address mailbox) Router(mailbox) {
        _transferOwnership(msg.sender);
        // Disable hook to allow value payments for Hyperlane gas
        setHook(address(0));
    }

    /**
     * @notice Deposit native MNT to contract (separate from transfer initiation).
     * @dev This allows amount to be hidden from transfer initiation call data.
     *      Persis seperti Umbra - deposit terpisah dari encrypted instructions.
     * @return depositId Unique identifier for this deposit.
     */
    function depositNative() external payable returns (bytes32 depositId) {
        require(msg.value > 0, "deposit required");
        depositId = keccak256(
            abi.encodePacked(
                msg.sender,
                block.chainid,
                block.number,
                _nonce++,
                "deposit"
            )
        );
        deposits[depositId] = Deposit({
            depositor: msg.sender,
            token: address(0),
            amount: msg.value,
            isNative: true,
            released: false
        });
        emit DepositCreated(depositId, msg.sender, address(0), msg.value, true);
    }

    /**
     * @notice Deposit ERC20 tokens to contract (separate from transfer initiation).
     * @dev Keeps amount out of transfer initiation call data (Umbra-like).
     * @param token ERC20 token address.
     * @param amount Amount of token to deposit.
     * @return depositId Unique identifier for this deposit.
     */
    function depositErc20(
        address token,
        uint256 amount
    ) external returns (bytes32 depositId) {
        require(token != address(0), "token required");
        require(amount > 0, "deposit required");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        depositId = keccak256(
            abi.encodePacked(
                msg.sender,
                block.chainid,
                block.number,
                _nonce++,
                "deposit"
            )
        );

        deposits[depositId] = Deposit({
            depositor: msg.sender,
            token: token,
            amount: amount,
            isNative: false,
            released: false
        });

        emit DepositCreated(depositId, msg.sender, token, amount, false);
    }

    /**
     * @notice Initiates a private transfer with encrypted instructions only (like Umbra).
     * @dev Amount is already in contract from previous deposit.
     *      Only encrypted instructions are visible in call data - persis seperti Umbra.
     * @param destinationDomain Hyperlane domain id (Sapphire Testnet).
     * @param depositId Deposit ID from previous deposit.
     * @param ciphertext Encrypted payload containing receiver/token/amount info.
     * @return transferId Unique identifier for this transfer.
     */
    function initiateTransfer(
        uint32 destinationDomain,
        bytes32 depositId,
        bytes calldata ciphertext
    ) external returns (bytes32 transferId) {
        Deposit storage depositData = deposits[depositId];
        require(depositData.depositor == msg.sender, "not your deposit");
        require(!depositData.released, "deposit already used");
        require(depositData.amount > 0, "deposit required");

        transferId = _initiateWithDeposit(destinationDomain, depositId, ciphertext);
    }

    /**
     * @notice Initiates a private transfer funded with native MNT (legacy - for backward compatibility).
     * @dev This function still shows amount in call data. Use depositNative() + initiateTransfer() for Umbra-like pattern.
     * @param destinationDomain Hyperlane domain id (Sapphire Testnet).
     * @param ciphertext Encrypted payload containing receiver/token/amount info.
     * @param depositAmount Amount of native token to escrow (in wei).
     * @return transferId Unique identifier for this transfer.
     */
    function initiateNativeTransfer(
        uint32 destinationDomain,
        bytes calldata ciphertext,
        uint256 depositAmount
    ) external payable returns (bytes32 transferId) {
        require(depositAmount > 0, "deposit required");
        require(msg.value >= depositAmount, "insufficient value");
        // create depositId for this single-use deposit
        bytes32 depositId = keccak256(
            abi.encodePacked(
                msg.sender,
                block.chainid,
                block.number,
                _nonce++,
                "deposit"
            )
        );
        deposits[depositId] = Deposit({
            depositor: msg.sender,
            token: address(0),
            amount: depositAmount,
            isNative: true,
            released: false
        });
        emit DepositCreated(depositId, msg.sender, address(0), depositAmount, true);
        transferId = _initiateWithDeposit(destinationDomain, depositId, ciphertext);
    }

    /**
     * @notice Initiates a private transfer funded with ERC20 tokens (e.g. USDC).
     * @param destinationDomain Hyperlane domain id (Sapphire Testnet).
     * @param token ERC20 token address.
     * @param amount Amount of token to escrow.
     * @param ciphertext Encrypted payload.
     * @return transferId Unique identifier for this transfer.
     */
    function initiateErc20Transfer(
        uint32 destinationDomain,
        address token,
        uint256 amount,
        bytes calldata ciphertext
    ) external payable returns (bytes32 transferId) {
        require(token != address(0), "token required");
        require(amount > 0, "amount required");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        bytes32 depositId = keccak256(
            abi.encodePacked(
                msg.sender,
                block.chainid,
                block.number,
                _nonce++,
                "deposit"
            )
        );
        deposits[depositId] = Deposit({
            depositor: msg.sender,
            token: token,
            amount: amount,
            isNative: false,
            released: false
        });
        emit DepositCreated(depositId, msg.sender, token, amount, false);
        transferId = _initiateWithDeposit(destinationDomain, depositId, ciphertext);
    }

    function _initiateWithDeposit(
        uint32 destinationDomain,
        bytes32 depositId,
        bytes calldata ciphertext
    ) internal returns (bytes32 transferId) {
        require(ciphertext.length > 0, "ciphertext required");
        require(destinationDomain != 0, "domain required");

        transferId = keccak256(
            abi.encodePacked(
                msg.sender,
                block.chainid,
                block.number,
                _nonce++
            )
        );

        transfers[transferId] = TransferMetadata({
            sender: msg.sender,
            destinationDomain: destinationDomain,
            dispatchedAt: block.timestamp,
            acknowledged: false
        });

        transferToDepositId[transferId] = depositId;

        bytes32 encryptedDataHash = keccak256(ciphertext);
        transferIdToCiphertextHash[transferId] = encryptedDataHash;
        ciphertextHashToTransferId[encryptedDataHash] = transferId;

        bytes memory payload = abi.encode(transferId, ciphertext);
        _Router_dispatch(destinationDomain, 0, payload);

        emit EncryptedInstructionsReceived(encryptedDataHash);
    }

    /**
     * @notice Handles acknowledgement messages from the Sapphire vault.
     * @dev Instead of directly transferring funds, we store them for withdrawal.
     *      This makes the transfer look like a deposit/withdraw pattern, not a direct transfer.
     */
    function _handle(
        uint32 _origin,
        bytes32,
        bytes calldata _message
    ) internal override {
        (
            bytes32 transferId,
            address receiver,
            address token,
            uint256 amount,
            bool isNative
        ) = abi.decode(_message, (bytes32, address, address, uint256, bool));

        TransferMetadata storage meta = transfers[transferId];
        require(meta.sender != address(0), "transfer missing");
        require(meta.destinationDomain == _origin, "unexpected origin");
        require(!meta.acknowledged, "already acknowledged");

        bytes32 depositId = transferToDepositId[transferId];
        Deposit storage depositData = deposits[depositId];
        require(!depositData.released, "already released");
        require(depositData.amount >= amount, "insufficient deposit");
        require(depositData.isNative == isNative, "type mismatch");
        require(
            depositData.isNative || depositData.token == token,
            "token mismatch"
        );

        meta.acknowledged = true;
        uint256 remaining = depositData.amount - amount;
        depositData.amount = remaining;
        if (remaining == 0) {
            depositData.released = true;
        }

        // ✅ Langsung transfer ke receiver - persis seperti Umbra (tidak ada withdrawal)
        // Umbra langsung transfer, tidak ada withdrawal pattern
        if (isNative) {
            (bool sent, ) = payable(receiver).call{value: amount}("");
            require(sent, "native transfer failed");
        } else {
            IERC20(token).safeTransfer(receiver, amount);
        }

        // ✅ Emit only encrypted data hash - persis seperti Umbra
        // Computation sudah terjadi di Oasis (confidential), seperti Umbra di Arcium
        // Hanya encrypted instructions hash yang terlihat di Mantle
        // Gunakan ciphertext hash yang sama seperti saat initiate (stored in mapping)
        bytes32 encryptedDataHash = transferIdToCiphertextHash[transferId];
        require(encryptedDataHash != bytes32(0), "ciphertext hash missing");
        emit EncryptedInstructionsProcessed(encryptedDataHash);
    }

    /**
     * @notice Helper to find transferId from ciphertext hash (tracking aid).
     */
    function getTransferIdByCiphertextHash(
        bytes32 encryptedDataHash
    ) external view returns (bytes32) {
        return ciphertextHashToTransferId[encryptedDataHash];
    }

}

