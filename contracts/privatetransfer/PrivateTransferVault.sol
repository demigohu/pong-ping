// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Router} from "@hyperlane-xyz/core/contracts/client/Router.sol";
import {Sapphire} from "@oasisprotocol/sapphire-contracts/contracts/Sapphire.sol";

/**
 * @title PrivateTransferVault
 * @notice Runs on Sapphire Testnet. Stores encrypted private transfer payloads
 *         coming from Mantle and decrypts them to trigger escrow releases.
 */
contract PrivateTransferVault is Router {
    struct EncryptedEnvelope {
        bytes32 senderPublicKey;
        bytes16 nonce;
        bytes ciphertext;
    }

    struct EncryptedTransfer {
        uint32 originDomain;
        bytes32 originRouter;
        EncryptedEnvelope envelope;
        bool acknowledged;
    }

    struct PrivatePayload {
        address receiver;
        address token;
        uint256 amount;
        bool isNative;
        bytes memo;
    }

    mapping(bytes32 => EncryptedTransfer) public encryptedTransfers;
    mapping(bytes32 => PrivatePayload) public processedPayloads;

    event EncryptedTransferStored(
        bytes32 indexed transferId,
        uint32 indexed originDomain,
        bytes32 indexed originRouter,
        bytes ciphertext
    );

    event TransferAcknowledged(
        bytes32 indexed transferId,
        uint32 indexed destinationDomain
    );

    event PrivatePayloadProcessed(
        bytes32 indexed transferId,
        address receiver,
        address token,
        uint256 amount,
        bool isNative
    );

    Sapphire.Curve25519PublicKey private _publicKey;
    Sapphire.Curve25519SecretKey private _secretKey;

    constructor(address mailbox) Router(mailbox) {
        _transferOwnership(msg.sender);
        setHook(address(0));
        (_publicKey, _secretKey) = Sapphire.generateCurve25519KeyPair("");
    }

    /**
     * @notice Receives ciphertext from Mantle ingress and stores it privately.
     */
    function _handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _message
    ) internal override {
        (bytes32 transferId, bytes memory rawEnvelope) = abi.decode(
            _message,
            (bytes32, bytes)
        );
        EncryptedEnvelope memory envelope = abi.decode(
            rawEnvelope,
            (EncryptedEnvelope)
        );

        EncryptedTransfer storage transfer = encryptedTransfers[transferId];
        transfer.originDomain = _origin;
        transfer.originRouter = _sender;
        transfer.envelope = envelope;
        transfer.acknowledged = false;

        emit EncryptedTransferStored(
            transferId,
            _origin,
            _sender,
            envelope.ciphertext
        );
    }

    /**
     * @notice Decrypts payload and dispatches release instruction back to Mantle.
     * @dev Needs to be funded with native token for Hyperlane gas payment.
     * @param transferId Identifier received in `_handle`.
     */
    function processTransfer(
        bytes32 transferId
    ) external payable onlyOwner {
        // Hooks/IGP are not configured yet, so native value is not supported.
        require(msg.value == 0, "no native gas payment supported");

        EncryptedTransfer storage transfer = encryptedTransfers[transferId];
        require(
            transfer.envelope.ciphertext.length != 0,
            "transfer missing"
        );
        require(!transfer.acknowledged, "already processed");

        PrivatePayload memory payload = abi.decode(
            _decryptEnvelope(transfer.envelope),
            (PrivatePayload)
        );

        transfer.acknowledged = true;
        processedPayloads[transferId] = payload;

        _Router_dispatch(
            transfer.originDomain,
            0,
            abi.encode(
                transferId,
                payload.receiver,
                payload.token,
                payload.amount,
                payload.isNative
            )
        );

        emit TransferAcknowledged(transferId, transfer.originDomain);
        emit PrivatePayloadProcessed(
            transferId,
            payload.receiver,
            payload.token,
            payload.amount,
            payload.isNative
        );
    }

    /**
     * @notice Decrypts and returns the plaintext payload for a given transfer.
     * @dev This call should be executed from Sapphire / confidential context so
     *      that the plaintext stays hidden from observers.
     */
    function revealTransfer(
        bytes32 transferId
    ) external view onlyOwner returns (bytes memory plaintext) {
        EncryptedTransfer storage transfer = encryptedTransfers[transferId];
        require(
            transfer.envelope.ciphertext.length != 0,
            "transfer missing"
        );
        plaintext = _decryptEnvelope(transfer.envelope);
    }

    function vaultPublicKey() external view returns (bytes32) {
        return Sapphire.Curve25519PublicKey.unwrap(_publicKey);
    }

    function _decryptEnvelope(
        EncryptedEnvelope memory envelope
    ) internal view returns (bytes memory) {
        bytes32 symmetricKey = Sapphire.deriveSymmetricKey(
            Sapphire.Curve25519PublicKey.wrap(envelope.senderPublicKey),
            _secretKey
        );
        bytes32 nonce = bytes32(envelope.nonce);
        return Sapphire.decrypt(symmetricKey, nonce, envelope.ciphertext, "");
    }
}

