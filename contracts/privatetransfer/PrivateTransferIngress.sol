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
        uint256 amount;
        bool isNative;
        bool released;
    }

    uint256 private _nonce;
    mapping(bytes32 => TransferMetadata) public transfers;
    mapping(bytes32 => Deposit) public deposits;

    event PrivateTransferInitiated(
        bytes32 indexed transferId,
        address indexed sender,
        uint32 indexed destinationDomain,
        bytes32 ciphertextHash,
        address token,
        uint256 amount,
        bool isNative
    );

    event PrivateTransferAcknowledged(bytes32 indexed transferId);
    event PrivateTransferReleased(
        bytes32 indexed transferId,
        address indexed receiver,
        address token,
        uint256 amount,
        bool isNative
    );

    constructor(address mailbox) Router(mailbox) {
        _transferOwnership(msg.sender);
        // Disable hook to allow value payments for Hyperlane gas
        setHook(address(0));
    }

    /**
     * @notice Initiates a private transfer funded with native MNT.
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
        uint256 gasFee = msg.value - depositAmount;
        transferId = _initiateTransfer(
            destinationDomain,
            ciphertext,
            address(0),
            depositAmount,
            true,
            gasFee
        );
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

        transferId = _initiateTransfer(
            destinationDomain,
            ciphertext,
            token,
            amount,
            false,
            msg.value
        );
    }

    function _initiateTransfer(
        uint32 destinationDomain,
        bytes calldata ciphertext,
        address token,
        uint256 amount,
        bool isNative,
        uint256 /* gasFee - unused, relayer pays gas via IGP */
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

        deposits[transferId] = Deposit({
            depositor: msg.sender,
            token: token,
            amount: amount,
            isNative: isNative,
            released: false
        });

        bytes memory payload = abi.encode(transferId, ciphertext);
        // Always dispatch with 0 value to avoid hook conflicts
        // Relayer will pay gas fees separately via IGP (Interchain Gas Paymaster)
        // The gasFee parameter is kept for future IGP integration
        _Router_dispatch(destinationDomain, 0, payload);

        emit PrivateTransferInitiated(
            transferId,
            msg.sender,
            destinationDomain,
            keccak256(ciphertext),
            token,
            amount,
            isNative
        );
    }

    /**
     * @notice Handles acknowledgement messages from the Sapphire vault.
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

        Deposit storage depositData = deposits[transferId];
        require(!depositData.released, "already released");
        require(depositData.amount == amount, "amount mismatch");
        require(depositData.isNative == isNative, "type mismatch");
        require(
            depositData.isNative || depositData.token == token,
            "token mismatch"
        );

        meta.acknowledged = true;
        depositData.released = true;

        if (isNative) {
            (bool sent, ) = payable(receiver).call{value: amount}("");
            require(sent, "native transfer failed");
        } else {
            IERC20(token).safeTransfer(receiver, amount);
        }

        emit PrivateTransferAcknowledged(transferId);
        emit PrivateTransferReleased(transferId, receiver, token, amount, isNative);
    }
}

