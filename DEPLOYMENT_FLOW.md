# Deployment Flow - Private Lending (Mantle + Sapphire)

Dokumen ini menjelaskan step-by-step flow deployment untuk Private Lending Protocol dari awal hingga siap digunakan.

---

## 📋 Prasyarat

### 1. Environment Variables (.env)

Pastikan `.env` berisi:

```bash
# Private Key (untuk deploy & transaksi)
PRIVATE_KEY=0x...

# RPC Endpoints
MANTLE_SEPOLIA_RPC=https://rpc.sepolia.mantle.xyz
SAPPHIRE_TESTNET_RPC=https://testnet.sapphire.oasis.io

# Hyperlane Mailbox Addresses
MANTLE_MAILBOX=0x598f...  # Mailbox address di Mantle Sepolia
SAPPHIRE_MAILBOX=0x79d3...  # Mailbox address di Sapphire Testnet

# (Opsional) Relayer address untuk ISM
TRUSTED_RELAYER=0x...  # Address relayer yang dipercaya
```

**Catatan**: 
- Mailbox addresses bisa ditemukan di [Hyperlane Docs](https://docs.hyperlane.xyz/docs/deployments/testnet-contracts)
- Pastikan wallet deployer punya gas di kedua chain (Mantle Sepolia & Sapphire Testnet)

### 2. Dependencies

```bash
npm install
```

### 3. Compile Contracts

```bash
npx hardhat compile
```

---

## 🚀 Step-by-Step Deployment

### Step 1: Deploy Contracts

#### 1.1 Deploy PrivateLendingIngress (Mantle Sepolia)

```bash
MANTLE_MAILBOX=0x598f... \
npx hardhat run scripts/privatelending/deploy/deployIngress.ts --network mantleSepolia
```

**Output**:
```
PrivateLendingIngress deployed at 0x...
```

**Catat**: `INGRESS_ADDRESS=0x...`

---

#### 1.2 Deploy LendingCore (Sapphire Testnet)

```bash
SAPPHIRE_MAILBOX=0x79d3... \
npx hardhat run scripts/privatelending/deploy/deployLendingCore.ts --network sapphireTestnet
```

**Output**:
```
LendingCore (Sapphire) deployed at 0x...
LendingCore public key: 0x...
```

**Catat**: 
- `CORE_ADDRESS=0x...`
- `LENDING_PUBLIC_KEY=0x...` (untuk encrypt payload di client)

---

#### 1.3 Deploy ISM (Trusted Relayer ISM di Mantle)

```bash
MANTLE_MAILBOX=0x598f... \
TRUSTED_RELAYER=0x... \  # Address relayer yang dipercaya
npx hardhat run scripts/privatelending/deploy/deployISM.ts --network mantleSepolia
```

**Output**:
```
TrustedRelayerISM deployed at 0x...
```

**Catat**: `ISM_ADDRESS=0x...`

**Catatan**: 
- ISM ini digunakan untuk memverifikasi bahwa message dari Mantle ke Sapphire berasal dari relayer yang dipercaya
- Untuk production, pertimbangkan menggunakan ISM yang lebih secure (misal Multisig ISM)

---

### Step 2: Enroll Hyperlane Routers

Router perlu tahu kemana mengirim message cross-chain.

#### 2.1 Enroll Ingress → LendingCore (Mantle → Sapphire)

```bash
INGRESS_ADDRESS=0x... \  # Dari Step 1.1
CORE_ADDRESS=0x... \     # Dari Step 1.2
SAPPHIRE_DOMAIN=23295 \
npx hardhat run scripts/privatelending/enroll/enrollIngress.ts --network mantleSepolia
```

**Output**:
```
Ingress now routes sapphire domain 23295 to 0x...
```

---

#### 2.2 Enroll LendingCore → Ingress (Sapphire → Mantle)

```bash
CORE_ADDRESS=0x... \     # Dari Step 1.2
INGRESS_ADDRESS=0x... \  # Dari Step 1.1
MANTLE_DOMAIN=5003 \
npx hardhat run scripts/privatelending/enroll/enrollLendingCore.ts --network sapphireTestnet
```

**Output**:
```
LendingCore now routes mantle domain 5003 to 0x...
```

---

### Step 3: Register ISM

Set ISM untuk memverifikasi incoming messages.

#### 3.1 Register ISM untuk Ingress (Mantle)

```bash
ROUTER_ADDRESS=0x... \  # INGRESS_ADDRESS dari Step 1.1
ISM_ADDRESS=0x... \     # Dari Step 1.3
npx hardhat run scripts/privatelending/enroll/registerIsm.ts --network mantleSepolia
```

**Output**:
```
ISM 0x... registered for router 0x... (tx: 0x...)
```

---

#### 3.2 Register ISM untuk LendingCore (Sapphire)

**Catatan**: Untuk Sapphire, biasanya tidak perlu ISM khusus karena Sapphire sudah confidential. Tapi jika ingin, bisa deploy ISM di Sapphire juga.

```bash
ROUTER_ADDRESS=0x... \  # CORE_ADDRESS dari Step 1.2
ISM_ADDRESS=0x... \     # ISM address di Sapphire (jika ada)
npx hardhat run scripts/privatelending/enroll/registerIsm.ts --network sapphireTestnet
```

**Catatan**: Jika tidak ada ISM di Sapphire, skip step ini. LendingCore akan menerima semua messages dari Mantle (karena sudah terverifikasi di Mantle).

---

### Step 4: Setup Oracle (Opsional - Bisa Skip Dulu)

**⚠️ Penting**: 
- **Untuk testing, Step 4 bisa di-skip dulu** dan langsung ke Step 5 (Configure) atau Step 6 (Test)
- Tapi **sebelum test supply/borrow**, minimal perlu update price manual untuk token yang akan digunakan
- Oracle **harus di-set di Sapphire** (di `LendingCore`), bukan di Mantle, karena:
  - Perhitungan health factor, collateral value, dan borrow value terjadi di `LendingCore` (Sapphire)
  - `_getPrice()` dipanggil saat `processAction()` di Sapphire
  - `PrivateLendingIngress` di Mantle hanya handle escrow/release, tidak perlu oracle

**Catatan tentang Oracle**:
- **Chainlink tidak tersedia di Oasis Sapphire**
- **Recommended**: Pakai **ROFL Oracle** (lihat [Oasis Docs](https://docs.oasis.io/build/use-cases/price-oracle/))
  - Deploy ROFL oracle contract di Sapphire
  - Deploy ROFL worker yang fetch price dari exchange (Binance, dll)
  - Worker submit observation ke contract dengan autentikasi `Subcall.roflEnsureAuthorizedOrigin()`
  - Contract aggregate dan update price
- **Untuk testing**: Gunakan **manual update** (lihat Step 4.2)
- **Alternatif**: Cross-chain oracle dari Mantle (Chainlink) → forward price via Hyperlane (lebih kompleks)

#### 4.1 Setup ROFL Oracle (Production - Recommended) - OPSIONAL

**ROFL Oracle adalah solusi oracle yang direkomendasikan untuk Oasis Sapphire.**

Lihat [Oasis ROFL Price Oracle Docs](https://docs.oasis.io/build/use-cases/price-oracle/) untuk setup lengkap:

1. **Deploy ROFL Oracle Contract** di Sapphire
   - Contract menggunakan `Subcall.roflEnsureAuthorizedOrigin(roflAppID)` untuk autentikasi
   - Contract meng-aggregate observations dari multiple ROFL workers
   - Contract expose `getLastObservation()` yang return `(uint128 value, uint block)`

2. **Deploy ROFL Worker** (di container) yang fetch price dari exchange (Binance, dll)
   - Worker submit observation ke contract via ROFL appd REST API
   - Worker berjalan secara berkala (misal setiap 60 detik)

3. **Set ROFL Oracle di LendingCore**:
```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> await core.setRoflOracle("0xTOKEN_ADDRESS", "0xROFL_ORACLE_CONTRACT_ADDRESS")
```

4. **Update price dari ROFL Oracle** (bisa otomatis via keeper atau manual):
```bash
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0x... \
npx hardhat run scripts/privatelending/service/updatePriceFromRoflOracle.ts --network sapphireTestnet
```

**Contoh untuk beberapa token**:

```bash
# Set ROFL Oracle untuk native MNT
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> await core.setRoflOracle("0x0", "0xROFL_ORACLE_MNT_ADDRESS")

# Set ROFL Oracle untuk USDC
> await core.setRoflOracle("0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", "0xROFL_ORACLE_USDC_ADDRESS")
```

**Untuk testing, skip step ini dan gunakan manual update (Step 4.2).**

**Catatan**: 
- ROFL Oracle menggunakan authenticated ROFL workers untuk submit observations
- Contract melakukan aggregation (misal: averaging) dari multiple observations
- `getLastObservation()` hanya return value jika observation masih fresh (MAX_OBSERVATION_AGE = 10 blocks)
- Lihat [Oasis ROFL Price Oracle Example](https://github.com/oasisprotocol/demo-rofl) untuk implementasi lengkap

---

### Step 5: Configure LendingCore (WAJIB untuk Testing)

**⚠️ PENTING**: Setiap token **WAJIB di-configure** sebelum bisa digunakan untuk supply/borrow, **sama seperti Aave**.

**Perbandingan dengan Aave**:
- **Aave**: Setiap token punya config (LTV, liquidation threshold, rates) yang di-set saat deploy atau via governance
- **Kita**: Config di-set manual via `configureToken()` sebelum token bisa digunakan
- **Keduanya sama**: Token tidak bisa digunakan tanpa config

#### 5.1 Set Token Config (LTV, Liquidation Threshold, Rates)

**WAJIB untuk setiap token yang akan digunakan!**

```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> await core.configureToken(
    "0xTOKEN",  // token address
    7500,       // LTV (75%) - maksimal % yang bisa borrow dari collateral
    8000,       // liquidation threshold (80%) - batas minimum HF sebelum liquidate
    1000,       // borrow rate (10% APR, dalam bps)
    500         // supply rate (5% APR, dalam bps)
  )
```

**Catatan**:
- Fungsi namanya `configureToken`, bukan `setTokenConfig`
- Parameter urutan: `(token, ltv, liquidationThreshold, borrowRate, supplyRate)`
- Rates dalam basis points (bps): 100 = 1%, 1000 = 10%
- `supplyRate` harus <= `borrowRate`
- `ltv` harus < `liquidationThreshold`
- **Tanpa config, token tidak bisa digunakan** - akan revert dengan "token not enabled"
- LTV = Loan-to-Value (berapa % bisa borrow dari collateral)
- Liquidation threshold = batas minimum HF sebelum bisa diliquidate

---

#### 5.2 Set Oracle Updater

```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> await core.setOracleUpdater("0x...")  // Address yang boleh update price manual
```

---

#### 5.3 Set Reserve Ratio di Ingress (Mantle)

```bash
npx hardhat console --network mantleSepolia
> const ingress = await ethers.getContractAt("PrivateLendingIngress", "0x...")
> await ingress.setReserveRatio(1000)  // 10% reserve (1000 bps)
```

---

### Step 6: Verify Deployment

#### 6.1 Check Ingress State

```bash
npx hardhat console --network mantleSepolia
> const ingress = await ethers.getContractAt("PrivateLendingIngress", "0x...")
> const coreRemote = await ingress.remotes(23295)  // Sapphire domain
> console.log("Remote LendingCore:", coreRemote)
```

#### 6.2 Check LendingCore State

```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const ingressRemote = await core.remotes(5003)  // Mantle domain
> console.log("Remote Ingress:", ingressRemote)
> const pubKey = await core.vaultPublicKey()
> console.log("Public Key:", pubKey)
```

#### 6.3 Check ROFL Oracle

```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const oracle = await core.roflOracles("0xTOKEN")
> console.log("ROFL Oracle:", oracle)
> if (oracle != "0x0") {
    const roflOracle = await ethers.getContractAt("IRoflOracle", oracle)
    const [value, blockNum] = await roflOracle.getLastObservation()
    console.log("Last Observation Value:", value.toString())
    console.log("Last Observation Block:", blockNum.toString())
  }
```

---

## ✅ Deployment Checklist

- [ ] Deploy `PrivateLendingIngress` di Mantle Sepolia
- [ ] Deploy `LendingCore` di Sapphire Testnet
- [ ] Deploy `ISM` di Mantle Sepolia
- [ ] Enroll Ingress → LendingCore (Mantle → Sapphire)
- [ ] Enroll LendingCore → Ingress (Sapphire → Mantle)
- [ ] Register ISM untuk Ingress (Mantle)
- [ ] **(WAJIB)** Configure token untuk setiap token yang akan digunakan (`configureToken()`)
- [ ] **(WAJIB untuk Testing)** Update price manual untuk semua token yang akan digunakan
- [ ] **(Opsional untuk Production)** Setup ROFL Oracle untuk update price otomatis
- [ ] Set reserve ratio di Ingress
- [ ] Verify semua state sudah benar

---

## 🧪 Testing End-to-End

Setelah deployment selesai, ikuti flow testing lengkap berikut untuk memastikan semua fitur bekerja dengan baik.

### Prasyarat Testing

1. **Token sudah di-configure** (Step 5.1)
2. **Price sudah di-update** (Step 4.2)
3. **Relayer Hyperlane aktif** untuk forward messages

---

### Step 1: Supply (Deposit Collateral)

**Tujuan**: User supply token sebagai collateral untuk bisa borrow.

```bash
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
TOKEN_TYPE=erc20 \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
TOKEN_DECIMALS=6 \
AMOUNT=100 \
npx hardhat run scripts/privatelending/service/supply.ts --network mantleSepolia
```

**Output yang diharapkan**:
```
Deposit erc20 ok. depositId=0x...
✅ Action ID: 0x...
To process this action on Sapphire, run:
CORE_ADDRESS=0x... ACTION_ID=0x... npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
Supply action dispatched.
```

**Catat**: `DEPOSIT_ID` dan `ACTION_ID` dari output

---

### Step 2: Process Supply di Sapphire

```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari Step 1
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Output yang diharapkan**:
```
✅ Action processed! Release instruction dispatched in tx 0x...
=== Processed Action Info ===
Action Type: 0 (SUPPLY)
Token: 0xAcab...
Amount: 100000000
On Behalf: 0x...
Deposit ID: 0x...
```

**Verifikasi Position**:
```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const pos = await core.positions("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> console.log("Collateral:", pos.collateral.toString())  // Harusnya > 0
> console.log("Borrow:", pos.borrow.toString())          // Harusnya 0
> await core.calculateHealthFactorForToken("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
// Harusnya: max value (karena borrow = 0)
```

---

### Step 3: Update Price (Jika Belum)

**WAJIB sebelum borrow** karena health factor calculation butuh price.

```bash
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
MANUAL_PRICE=1.0 \
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet
```

**Verifikasi Price**:
```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const price = await core.prices("0xTOKEN_ADDRESS")
> console.log("Price:", price.price.toString())
> console.log("Valid:", price.valid)
```

---

### Step 4: Borrow

**Tujuan**: User borrow token menggunakan collateral dari Step 1.

```bash
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
DEPOSIT_ID=0x... \  # Deposit ID dari Step 1 (atau deposit baru)
TOKEN_TYPE=erc20 \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
TOKEN_DECIMALS=6 \
AMOUNT=50 \  # Borrow 50 (harus < collateral * LTV)
npx hardhat run scripts/privatelending/service/borrow.ts --network mantleSepolia
```

**Output yang diharapkan**:
```
✅ Action ID: 0x...
To process this action on Sapphire, run:
CORE_ADDRESS=0x... ACTION_ID=0x... npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
Borrow action dispatched (release will happen after Sapphire check).
```

**Catat**: `ACTION_ID` dari output

---

### Step 5: Process Borrow di Sapphire

```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari Step 4
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Output yang diharapkan**:
```
✅ Action processed! Release instruction dispatched in tx 0x...
=== Processed Action Info ===
Action Type: 1 (BORROW)
Amount: 50000000
```

**Verifikasi Position & Health Factor**:
```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const pos = await core.positions("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> console.log("Collateral:", pos.collateral.toString())  // Harusnya > 0
> console.log("Borrow:", pos.borrow.toString())          // Harusnya > 0
> const hf = await core.calculateHealthFactorForToken("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> console.log("Health Factor:", hf.toString())
// Harusnya: HF >= 1.0 (1000000000000000000)
```

**Catatan**: 
- Release instruction akan dikirim ke Mantle
- Relayer akan forward message
- User akan menerima borrowed funds di Mantle (cek balance di Mantle)

---

### Step 6: Repay (Bayar Pinjaman)

**Tujuan**: User bayar sebagian atau semua borrow.

**6.1 Deposit dulu untuk repay**:
```bash
INGRESS_ADDRESS=0x... \
TOKEN_TYPE=erc20 \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
TOKEN_DECIMALS=6 \
AMOUNT=55 \  # Include interest
npx hardhat run scripts/privatelending/service/deposit.ts --network mantleSepolia
```

**Catat**: `DEPOSIT_ID` baru

**6.2 Submit repay action**:
```bash
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
DEPOSIT_ID=0x... \  # Deposit ID baru dari Step 6.1
TOKEN_TYPE=erc20 \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
TOKEN_DECIMALS=6 \
AMOUNT=55 \
npx hardhat run scripts/privatelending/service/repay.ts --network mantleSepolia
```

**Catat**: `ACTION_ID` dari output

**6.3 Process di Sapphire**:
```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari Step 6.2
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Verifikasi**: Borrow harus berkurang atau jadi 0.

---

### Step 7: Withdraw Collateral

**Tujuan**: User tarik kembali collateral setelah borrow dibayar.

```bash
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
DEPOSIT_ID=0x... \  # Deposit ID dari Step 1
TOKEN_TYPE=erc20 \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
TOKEN_DECIMALS=6 \
AMOUNT=50 \
npx hardhat run scripts/privatelending/service/withdraw.ts --network mantleSepolia
```

**Catat**: `ACTION_ID` dari output

**Process di Sapphire**:
```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari withdraw
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Verifikasi**: 
- Collateral berkurang
- HF tetap >= 1.0
- Release instruction dikirim ke Mantle
- User menerima withdrawn funds di Mantle

---

### Step 8: Verifikasi Final State

**Cek User Position**:
```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const pos = await core.positions("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> console.log("Collateral:", pos.collateral.toString())
> console.log("Borrow:", pos.borrow.toString())
```

**Cek Health Factor**:
```bash
> await core.calculateHealthFactorForToken("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
// Harusnya: >= 1.0 atau max (jika borrow = 0)
```

**Cek Token Config**:
```bash
> const config = await core.tokenConfigs("0xTOKEN_ADDRESS")
> console.log("Enabled:", config.enabled)
> console.log("Total Supply:", config.totalSupply.toString())
> console.log("Total Borrow:", config.totalBorrow.toString())
```

**Cek Position Hash (Privacy)**:
```bash
> const hash = await core.computePositionHash("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> console.log("Position Hash:", hash)
// Hash ini yang terlihat di event PositionUpdated (bukan amounts)
```

---

## ✅ Testing Checklist

- [ ] Supply berhasil - collateral bertambah
- [ ] Borrow berhasil - borrow bertambah, HF >= 1.0
- [ ] Repay berhasil - borrow berkurang
- [ ] Withdraw berhasil - collateral berkurang, HF tetap >= 1.0
- [ ] Release instruction dikirim ke Mantle untuk borrow/withdraw
- [ ] User menerima funds di Mantle setelah release
- [ ] Position hash terlihat di event (bukan amounts) - **Privacy**
- [ ] Health factor calculation bekerja dengan benar
- [ ] Interest accrual bekerja (jika ada time elapsed)

---

## 🔍 Troubleshooting Testing

### "token not enabled"
- **Fix**: Run `configureToken()` untuk token tersebut (Step 5.1)

### "health factor too low"
- **Fix**: Supply lebih banyak collateral atau repay sebagian borrow

### "price stale" atau "invalid price"
- **Fix**: Update price via `updatePrice.ts` (Step 3)

### "insufficient liquidity"
- **Fix**: Pastikan ada cukup supply di pool, atau kurangi amount borrow/withdraw

### "action not found" saat processAction
- **Fix**: Pastikan relayer sudah forward message dari Mantle ke Sapphire
- **Cek**: Tunggu beberapa detik setelah submit action di Mantle

### "Action already processed"
- **Fix**: Gunakan ACTION_ID yang baru, bukan yang sudah diproses
- **Cek**: Pastikan ACTION_ID dari output script terbaru

---

## 📊 Expected Results

Setelah testing lengkap, expected state:

1. **User Position**:
   - Collateral: Sesuai dengan supply - withdraw
   - Borrow: Sesuai dengan borrow - repay
   - HF: >= 1.0 (safe)

2. **Token Config**:
   - Total Supply: Sum dari semua supply
   - Total Borrow: Sum dari semua borrow
   - Rates: Sesuai dengan config

3. **Privacy**:
   - Event `PositionUpdated` hanya emit hash, bukan amounts
   - Payload di Mantle terenkripsi (hanya ciphertext terlihat)
   - Position amounts hanya bisa diakses via contract query

---

## 📚 Next Steps

Setelah testing berhasil:
- Lihat `TESTING_FLOW.md` untuk detail lebih lengkap
- Lihat `PRIVACY_POSITION_EVENTS.md` untuk penjelasan privacy
- Lihat `PRIVATE_LENDING_FLOW.md` untuk flow detail

---

## 🔄 Maintenance

### Update Price Secara Berkala

**Untuk Testing (Manual)**:
```bash
# Update price manual setiap kali sebelum test
CORE_ADDRESS=0x... TOKEN_ADDRESS=0x... MANUAL_PRICE=1.0 \
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet
```

**Untuk Production (Otomatis dengan ROFL Oracle)**:
```bash
# Option 1: Update dari ROFL Oracle (Recommended)
# Setup ROFL Oracle worker yang update otomatis, lalu:
CORE_ADDRESS=0x... TOKEN_ADDRESS=0x... USE_ROFL_ORACLE=true \
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet

# Option 2: Cron job untuk update dari ROFL Oracle (setiap jam)
0 * * * * cd /path/to/project && CORE_ADDRESS=0x... TOKEN_ADDRESS=0x... USE_ROFL_ORACLE=true npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet

# Option 3: Manual update (fallback)
CORE_ADDRESS=0x... TOKEN_ADDRESS=0x... MANUAL_PRICE=1.0 \
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet
```

### Monitor Health Factors

Monitor user positions dan alert jika HF < 1.0 untuk liquidation:

```bash
# Script untuk monitor (contoh)
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const hf = await core.calculateHealthFactorForToken("0xUSER", "0xTOKEN")
> if (hf < 1e18) console.log("⚠️ User liquidatable!")
```

### Monitor Position Privacy

Pastikan event `PositionUpdated` hanya emit hash, bukan amounts:

```bash
# Cek event di explorer atau via script
# Event harusnya: PositionUpdated(user, token, positionHash)
# Bukan: PositionUpdated(user, token, collateral, borrow)
```

---

## 🐛 Troubleshooting

### Deployment Issues

#### "Remote router not enrolled"
- **Fix**: Pastikan Step 2 (Enroll Routers) sudah dijalankan untuk kedua chain

#### "ISM not registered"
- **Fix**: Pastikan Step 3 (Register ISM) sudah dijalankan

#### "rofl oracle not set"
- **Fix**: Set ROFL Oracle via Step 4.1 sebelum update price, atau gunakan manual update (Step 4.2) (atau gunakan manual update)

### Testing Issues

#### "token not enabled"
- **Fix**: Run `configureToken()` untuk token tersebut (Step 5.1)

#### "health factor too low"
- **Fix**: Supply lebih banyak collateral atau repay sebagian borrow

#### "price stale" atau "invalid price"
- **Fix**: Update price via `updatePrice.ts` (Step 4.2 atau Step 3 di testing)

#### "insufficient liquidity"
- **Fix**: Pastikan ada cukup supply di pool, atau kurangi amount borrow/withdraw

#### "action not found" saat processAction
- **Fix**: Pastikan relayer sudah forward message dari Mantle ke Sapphire
- **Cek**: Tunggu beberapa detik setelah submit action di Mantle

#### "Action already processed"
- **Fix**: Gunakan ACTION_ID yang baru, bukan yang sudah diproses
- **Cek**: Pastikan ACTION_ID dari output script terbaru
- **Helper**: Gunakan `getActionId.ts` untuk get ACTION_ID dari transaction hash

#### "getUserPosition is not a function"
- **Fix**: Gunakan `positions(user, token)` mapping, bukan `getUserPosition()`
- **Contoh**: `await core.positions("0xUSER", "0xTOKEN")`

---

## 📚 Next Steps

Setelah deployment selesai:
- **Testing**: Ikuti flow testing end-to-end di section "🧪 Testing End-to-End" di atas
- **Detail Flow**: Lihat `TESTING_FLOW.md` untuk detail lebih lengkap
- **Privacy**: Lihat `PRIVACY_POSITION_EVENTS.md` untuk penjelasan privacy events
- **Flow Detail**: Lihat `PRIVATE_LENDING_FLOW.md` untuk flow detail dan troubleshooting
- **README**: Lihat `README.md` untuk dokumentasi umum

---

## 🔗 References

- [Hyperlane Docs](https://docs.hyperlane.xyz/)
- [Oasis Sapphire Docs](https://docs.oasis.io/build/sapphire/)
- [Oasis ROFL Price Oracle](https://docs.oasis.io/build/use-cases/price-oracle/)
- [ROFL Price Oracle Example](https://github.com/oasisprotocol/demo-rofl)

