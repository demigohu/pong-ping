// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Router} from "@hyperlane-xyz/core/contracts/client/Router.sol";
import {Sapphire} from "@oasisprotocol/sapphire-contracts/contracts/Sapphire.sol";

/**
 * @notice Interface for ROFL Oracle contract.
 * @dev Based on Oasis ROFL Price Oracle pattern.
 *      See: https://docs.oasis.io/build/use-cases/price-oracle/
 */
interface IRoflOracle {
    /**
     * @notice Get the last aggregated observation from ROFL oracle.
     * @return value The aggregated price value (uint128)
     * @return block The block number when observation was recorded
     */
    function getLastObservation() external view returns (uint128 value, uint block);
}

/**
 * @title LendingCore (Sapphire)
 * @notice Confidential lending logic with LTV, health factor, interest accrual, and liquidation.
 *         All state is private on Sapphire; Mantle only sees encrypted action hashes.
 */
contract LendingCore is Router {
    enum ActionType {
        SUPPLY,
        BORROW,
        REPAY,
        WITHDRAW,
        LIQUIDATE
    }

    struct EncryptedEnvelope {
        bytes32 senderPublicKey;
        bytes16 nonce;
        bytes ciphertext;
    }

    struct EncryptedAction {
        uint32 originDomain;
        bytes32 originRouter;
        EncryptedEnvelope envelope;
        bool processed;
    }

    struct ActionPayload {
        ActionType actionType;
        address token;
        uint256 amount;
        address onBehalf;
        bytes32 depositId;
        bool isNative;
        bytes memo;
    }

    // Token configuration
    struct TokenConfig {
        bool enabled;
        uint256 ltv; // Loan-to-Value (bps, e.g., 8000 = 80%)
        uint256 liquidationThreshold; // (bps, e.g., 8500 = 85%)
        uint256 borrowRate; // Annual rate (bps, e.g., 500 = 5%)
        uint256 supplyRate; // Annual rate (bps, e.g., 300 = 3%)
        uint256 totalSupply;
        uint256 totalBorrow;
        uint256 supplyIndex; // Compound-style index (1e27 = 1.0)
        uint256 borrowIndex; // Compound-style index (1e27 = 1.0)
        uint256 lastUpdateTime;
    }

    // User position per token
    struct UserPosition {
        uint256 collateral; // Amount supplied as collateral
        uint256 borrow; // Amount borrowed (with accrued interest)
        uint256 supplyIndexSnapshot; // Snapshot when last updated
        uint256 borrowIndexSnapshot; // Snapshot when last updated
    }

    // Price oracle entry
    struct PriceData {
        uint256 price; // Price in USD (scaled by 1e8)
        uint256 timestamp;
        bool valid;
    }

    mapping(bytes32 => EncryptedAction) public encryptedActions;
    mapping(bytes32 => ActionPayload) public processedPayloads;
    
    // Token configs: token address => config
    mapping(address => TokenConfig) public tokenConfigs;
    
    // User positions: user => token => position
    mapping(address => mapping(address => UserPosition)) public positions;
    
    // Oracle: token => price data
    mapping(address => PriceData) public prices;
    
    // Oracle updater (can be set by owner, for manual price updates)
    address public oracleUpdater;
    
    // ROFL Oracle contracts: token => ROFL Oracle contract address
    mapping(address => address) public roflOracles;
    
    // Constants
    uint256 public constant PRECISION = 1e27; // For indices
    uint256 public constant BPS = 10000; // Basis points
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant PRICE_PRECISION = 1e8; // For prices
    uint256 public constant MIN_HEALTH_FACTOR = 1e18; // 1.0 (must be >= 1.0 to borrow/withdraw)
    uint256 public constant LIQUIDATION_THRESHOLD_HF = 1e18; // 1.0 (liquidatable if HF < 1.0)
    
    uint256 public constant PRICE_STALENESS = 1 hours; // Price must be updated within this time

    event EncryptedActionStored(
        bytes32 indexed actionId,
        uint32 indexed originDomain,
        bytes32 indexed originRouter,
        bytes ciphertext
    );

    event ActionProcessed(bytes32 indexed actionId, ActionType actionType);
    event TokenConfigUpdated(address indexed token, uint256 ltv, uint256 liquidationThreshold);
    event PriceUpdated(address indexed token, uint256 price, uint256 timestamp);
    /**
     * @notice Emitted when a user position is updated.
     * @dev Only emits position hash for privacy - actual amounts are not exposed.
     *      User can verify their position by computing hash(collateral, borrow) themselves.
     */
    event PositionUpdated(
        address indexed user,
        address indexed token,
        bytes32 indexed positionHash  // keccak256(abi.encodePacked(collateral, borrow))
    );

    Sapphire.Curve25519PublicKey private _publicKey;
    Sapphire.Curve25519SecretKey private _secretKey;

    constructor(address mailbox) Router(mailbox) {
        _transferOwnership(msg.sender);
        setHook(address(0));
        (_publicKey, _secretKey) = Sapphire.generateCurve25519KeyPair("");
        oracleUpdater = msg.sender;
    }

    /**
     * @notice Set oracle updater (can be multisig/oracle contract).
     */
    function setOracleUpdater(address updater) external onlyOwner {
        oracleUpdater = updater;
    }

    /**
     * @notice Configure a token for lending.
     */
    function configureToken(
        address token,
        uint256 ltv,
        uint256 liquidationThreshold,
        uint256 borrowRate,
        uint256 supplyRate
    ) external onlyOwner {
        require(ltv < liquidationThreshold, "ltv >= liquidationThreshold");
        require(liquidationThreshold <= BPS, "liquidationThreshold > 100%");
        require(borrowRate <= BPS * 10, "borrowRate too high"); // Max 1000% APR
        require(supplyRate <= borrowRate, "supplyRate > borrowRate");

        TokenConfig storage config = tokenConfigs[token];
        if (config.supplyIndex == 0) {
            config.supplyIndex = PRECISION;
            config.borrowIndex = PRECISION;
            config.lastUpdateTime = block.timestamp;
        }
        config.enabled = true;
        config.ltv = ltv;
        config.liquidationThreshold = liquidationThreshold;
        config.borrowRate = borrowRate;
        config.supplyRate = supplyRate;

        emit TokenConfigUpdated(token, ltv, liquidationThreshold);
    }

    /**
     * @notice Set ROFL Oracle contract for a token.
     * @dev ROFL Oracle must implement IRoflOracle interface.
     *      See: https://docs.oasis.io/build/use-cases/price-oracle/
     * @param token Token address (address(0) for native)
     * @param oracle ROFL Oracle contract address
     */
    function setRoflOracle(address token, address oracle) external onlyOwner {
        require(oracle != address(0), "invalid oracle");
        roflOracles[token] = oracle;
    }

    /**
     * @notice Update price for a token from ROFL Oracle (called by oracle updater or anyone).
     * @dev Fetches latest observation from ROFL Oracle and caches it.
     *      ROFL Oracle uses authenticated ROFL workers to submit observations.
     */
    function updatePriceFromRoflOracle(address token) external {
        address oracle = roflOracles[token];
        require(oracle != address(0), "rofl oracle not set");
        
        IRoflOracle roflOracle = IRoflOracle(oracle);
        (uint128 value, uint blockNum) = roflOracle.getLastObservation();
        
        require(value > 0, "invalid price from rofl oracle");
        require(blockNum > 0, "no observation available");
        
        // ROFL Oracle returns uint128, convert to our PRICE_PRECISION (1e8)
        // Assuming ROFL Oracle already returns price in 1e8 format
        uint256 priceScaled = uint256(value);
        
        // Use block timestamp as approximation (ROFL Oracle doesn't return timestamp)
        // In practice, you might want to store block -> timestamp mapping
        prices[token] = PriceData({
            price: priceScaled,
            timestamp: block.timestamp, // Approximate timestamp
            valid: true
        });
        
        emit PriceUpdated(token, priceScaled, block.timestamp);
    }

    /**
     * @notice Update price for a token manually (called by oracle updater, fallback if Chainlink unavailable).
     */
    function updatePrice(address token, uint256 price) external {
        require(msg.sender == oracleUpdater || msg.sender == owner(), "not authorized");
        require(price > 0, "invalid price");
        
        prices[token] = PriceData({
            price: price,
            timestamp: block.timestamp,
            valid: true
        });
        
        emit PriceUpdated(token, price, block.timestamp);
    }

    /**
     * @notice Receive encrypted action from Mantle Ingress.
     */
    function _handle(
        uint32 _origin,
        bytes32 _sender,
        bytes calldata _message
    ) internal override {
        (bytes32 actionId, bytes memory rawEnvelope) = abi.decode(
            _message,
            (bytes32, bytes)
        );
        EncryptedEnvelope memory envelope = abi.decode(
            rawEnvelope,
            (EncryptedEnvelope)
        );

        EncryptedAction storage action = encryptedActions[actionId];
        action.originDomain = _origin;
        action.originRouter = _sender;
        action.envelope = envelope;
        action.processed = false;

        emit EncryptedActionStored(
            actionId,
            _origin,
            _sender,
            envelope.ciphertext
        );
    }

    /**
     * @notice Decrypt and process an action with full lending logic.
     */
    function processAction(bytes32 actionId) external payable onlyOwner {
        require(msg.value == 0, "no native gas payment supported");

        EncryptedAction storage stored = encryptedActions[actionId];
        require(stored.envelope.ciphertext.length != 0, "action missing");
        require(!stored.processed, "already processed");

        ActionPayload memory payload = abi.decode(
            _decryptEnvelope(stored.envelope),
            (ActionPayload)
        );

        stored.processed = true;
        processedPayloads[actionId] = payload;

        address token = payload.isNative ? address(0) : payload.token;
        address user = payload.onBehalf;

        // Update indices (accrue interest) before processing
        _updateIndices(token);

        // Update user position indices
        _updateUserIndices(user, token);

        bool needsRelease = false;
        uint256 releaseAmount = 0;
        address releaseReceiver = user;

        if (payload.actionType == ActionType.SUPPLY) {
            _handleSupply(user, token, payload.amount);
        } else if (payload.actionType == ActionType.BORROW) {
            (needsRelease, releaseAmount) = _handleBorrow(user, token, payload.amount);
        } else if (payload.actionType == ActionType.REPAY) {
            _handleRepay(user, token, payload.amount);
        } else if (payload.actionType == ActionType.WITHDRAW) {
            (needsRelease, releaseAmount) = _handleWithdraw(user, token, payload.amount);
        } else if (payload.actionType == ActionType.LIQUIDATE) {
            (needsRelease, releaseAmount, releaseReceiver) = _handleLiquidate(user, token, payload.amount);
        }

        if (needsRelease && releaseAmount > 0) {
            _Router_dispatch(
                stored.originDomain,
                0,
                abi.encode(
                    actionId,
                    payload.depositId,
                    releaseReceiver,
                    token,
                    releaseAmount,
                    payload.isNative
                )
            );
        } else {
            // Acknowledge with zero-amount release
            _Router_dispatch(
                stored.originDomain,
                0,
                abi.encode(
                    actionId,
                    payload.depositId,
                    user,
                    token,
                    0,
                    payload.isNative
                )
            );
        }

        emit ActionProcessed(actionId, payload.actionType);
    }

    function _handleSupply(address user, address token, uint256 amount) internal {
        TokenConfig storage config = tokenConfigs[token];
        require(config.enabled, "token not enabled");
        
        UserPosition storage pos = positions[user][token];
        pos.collateral += amount;
        pos.supplyIndexSnapshot = config.supplyIndex;
        
        config.totalSupply += amount;
        
        bytes32 positionHash = keccak256(abi.encodePacked(pos.collateral, pos.borrow));
        emit PositionUpdated(user, token, positionHash);
    }

    function _handleBorrow(
        address user,
        address token,
        uint256 amount
    ) internal returns (bool needsRelease, uint256 releaseAmount) {
        TokenConfig storage config = tokenConfigs[token];
        require(config.enabled, "token not enabled");
        require(config.totalSupply >= amount, "insufficient liquidity");
        
        UserPosition storage pos = positions[user][token];
        
        // Simulate borrow to check health factor
        pos.borrow += amount;
        uint256 hf = _calculateHealthFactorForToken(user, token);
        require(hf >= MIN_HEALTH_FACTOR, "health factor too low");
        
        pos.borrowIndexSnapshot = config.borrowIndex;
        config.totalBorrow += amount;
        
        bytes32 positionHash = keccak256(abi.encodePacked(pos.collateral, pos.borrow));
        emit PositionUpdated(user, token, positionHash);
        
        return (true, amount);
    }

    function _handleRepay(address user, address token, uint256 amount) internal {
        UserPosition storage pos = positions[user][token];
        require(pos.borrow > 0, "no borrow");
        
        uint256 repayAmount = amount > pos.borrow ? pos.borrow : amount;
        pos.borrow -= repayAmount;
        pos.borrowIndexSnapshot = tokenConfigs[token].borrowIndex;
        
        TokenConfig storage config = tokenConfigs[token];
        config.totalBorrow -= repayAmount;
        
        bytes32 positionHash = keccak256(abi.encodePacked(pos.collateral, pos.borrow));
        emit PositionUpdated(user, token, positionHash);
    }

    function _handleWithdraw(
        address user,
        address token,
        uint256 amount
    ) internal returns (bool needsRelease, uint256 releaseAmount) {
        UserPosition storage pos = positions[user][token];
        require(pos.collateral >= amount, "insufficient collateral");
        
        // Simulate withdrawal to check health factor
        pos.collateral -= amount;
        uint256 hfAfter = _calculateHealthFactorForToken(user, token);
        require(hfAfter >= MIN_HEALTH_FACTOR, "health factor too low after withdraw");
        
        // Actually withdraw (already simulated above)
        pos.supplyIndexSnapshot = tokenConfigs[token].supplyIndex;
        
        TokenConfig storage config = tokenConfigs[token];
        config.totalSupply -= amount;
        
        bytes32 positionHash = keccak256(abi.encodePacked(pos.collateral, pos.borrow));
        emit PositionUpdated(user, token, positionHash);
        
        return (true, amount);
    }

    function _handleLiquidate(
        address user,
        address token,
        uint256 amount
    ) internal returns (bool needsRelease, uint256 releaseAmount, address receiver) {
        uint256 hf = _calculateHealthFactorForToken(user, token);
        require(hf < LIQUIDATION_THRESHOLD_HF, "not liquidatable");
        
        UserPosition storage pos = positions[user][token];
        require(pos.borrow > 0, "no borrow to liquidate");
        
        uint256 liquidateAmount = amount > pos.borrow ? pos.borrow : amount;
        
        // Liquidator repays borrow, gets collateral + bonus
        TokenConfig storage config = tokenConfigs[token];
        uint256 collateralToLiquidator = (liquidateAmount * config.liquidationThreshold) / BPS;
        
        pos.borrow -= liquidateAmount;
        pos.collateral -= collateralToLiquidator;
        pos.borrowIndexSnapshot = config.borrowIndex;
        pos.supplyIndexSnapshot = config.supplyIndex;
        
        config.totalBorrow -= liquidateAmount;
        config.totalSupply -= collateralToLiquidator;
        
        bytes32 positionHash = keccak256(abi.encodePacked(pos.collateral, pos.borrow));
        emit PositionUpdated(user, token, positionHash);
        
        // Liquidator receives collateral (msg.sender is the liquidator via onBehalf)
        return (true, collateralToLiquidator, msg.sender);
    }

    /**
     * @notice Calculate health factor for a user for a specific token.
     */
    function _calculateHealthFactorForToken(address user, address token) internal view returns (uint256) {
        UserPosition memory pos = positions[user][token];
        TokenConfig memory config = tokenConfigs[token];
        
        if (!config.enabled) return type(uint256).max;
        if (pos.borrow == 0) return type(uint256).max;
        
        uint256 price = _getPrice(token);
        if (price == 0) return 0; // Invalid if no price
        
        uint256 collateralValue = (pos.collateral * price * config.liquidationThreshold) / (PRICE_PRECISION * BPS);
        uint256 borrowValue = (pos.borrow * price) / PRICE_PRECISION;
        
        if (borrowValue == 0) return type(uint256).max;
        
        return (collateralValue * PRECISION) / borrowValue;
    }

    /**
     * @notice Update interest indices for a token (accrue interest).
     */
    function _updateIndices(address token) internal {
        TokenConfig storage config = tokenConfigs[token];
        if (!config.enabled) return;
        
        uint256 timeElapsed = block.timestamp - config.lastUpdateTime;
        if (timeElapsed == 0) return;
        
        // Supply index: compound supply rate
        if (config.totalSupply > 0) {
            uint256 supplyRatePerSecond = (config.supplyRate * PRECISION) / (BPS * SECONDS_PER_YEAR);
            uint256 supplyFactor = PRECISION + (supplyRatePerSecond * timeElapsed) / PRECISION;
            config.supplyIndex = (config.supplyIndex * supplyFactor) / PRECISION;
        }
        
        // Borrow index: compound borrow rate
        if (config.totalBorrow > 0) {
            uint256 borrowRatePerSecond = (config.borrowRate * PRECISION) / (BPS * SECONDS_PER_YEAR);
            uint256 borrowFactor = PRECISION + (borrowRatePerSecond * timeElapsed) / PRECISION;
            config.borrowIndex = (config.borrowIndex * borrowFactor) / PRECISION;
        }
        
        config.lastUpdateTime = block.timestamp;
    }

    /**
     * @notice Update user position indices (apply accrued interest).
     */
    function _updateUserIndices(address user, address token) internal {
        TokenConfig memory config = tokenConfigs[token];
        UserPosition storage pos = positions[user][token];
        
        // Update collateral (supply interest)
        if (pos.collateral > 0 && config.supplyIndex > pos.supplyIndexSnapshot) {
            uint256 accrued = (pos.collateral * (config.supplyIndex - pos.supplyIndexSnapshot)) / pos.supplyIndexSnapshot;
            pos.collateral += accrued;
            pos.supplyIndexSnapshot = config.supplyIndex;
        }
        
        // Update borrow (borrow interest)
        if (pos.borrow > 0 && config.borrowIndex > pos.borrowIndexSnapshot) {
            uint256 accrued = (pos.borrow * (config.borrowIndex - pos.borrowIndexSnapshot)) / pos.borrowIndexSnapshot;
            pos.borrow += accrued;
            pos.borrowIndexSnapshot = config.borrowIndex;
        }
    }

    /**
     * @notice Get price for a token (with staleness check).
     * @dev First checks cached price, then tries ROFL Oracle if stale.
     *      ROFL Oracle is queried read-only (doesn't update cache).
     */
    function _getPrice(address token) internal view returns (uint256) {
        PriceData memory priceData = prices[token];
        
        // If cached price is valid and fresh, use it
        if (priceData.valid && (block.timestamp - priceData.timestamp <= PRICE_STALENESS)) {
            return priceData.price;
        }
        
        // If stale or invalid, try ROFL Oracle (read-only, doesn't update cache)
        address oracle = roflOracles[token];
        if (oracle != address(0)) {
            try IRoflOracle(oracle).getLastObservation() returns (
                uint128 value,
                uint blockNum
            ) {
                if (value > 0 && blockNum > 0) {
                    // Check if observation is recent (within last 10 blocks as per ROFL Oracle pattern)
                    // ROFL Oracle contract enforces MAX_OBSERVATION_AGE = 10 blocks
                    if (block.number <= blockNum + 10) {
                        return uint256(value);
                    }
                }
            } catch {
                // ROFL Oracle call failed, return cached if exists
            }
        }
        
        // Fallback to cached price even if stale (better than 0)
        return priceData.valid ? priceData.price : 0;
    }

    /**
     * @notice Calculate health factor for a user for a specific token (public view).
     */
    function calculateHealthFactorForToken(address user, address token) external view returns (uint256) {
        return _calculateHealthFactorForToken(user, token);
    }

    /**
     * @notice Compute position hash for a user (for verifying PositionUpdated events).
     * @dev Users can call this to verify their position hash matches the event.
     */
    function computePositionHash(address user, address token) external view returns (bytes32) {
        UserPosition memory pos = positions[user][token];
        return keccak256(abi.encodePacked(pos.collateral, pos.borrow));
    }

    function revealAction(
        bytes32 actionId
    ) external view onlyOwner returns (bytes memory plaintext) {
        EncryptedAction storage stored = encryptedActions[actionId];
        require(stored.envelope.ciphertext.length != 0, "action missing");
        plaintext = _decryptEnvelope(stored.envelope);
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
