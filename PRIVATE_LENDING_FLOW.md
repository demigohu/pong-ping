# Private Lending Flow (Mantle + Sapphire)

Dokumen ini menjelaskan alur lengkap untuk private lending dengan Oracle Chainlink dan proses release dari Sapphire ke Mantle.

---

## 1. Setup Oracle (Opsional - Bisa Skip Dulu)

**⚠️ Penting**: 
- **Untuk testing, Step 1.1 bisa di-skip dulu** jika Sapphire belum punya Chainlink feeds
- Tapi **Step 1.2 (Update Price Manual) WAJIB** sebelum test supply/borrow, karena health factor butuh price
- Chainlink feeds **harus di-set di Sapphire** (di `LendingCore`), bukan di Mantle, karena:
  - Perhitungan health factor, collateral value, dan borrow value terjadi di `LendingCore` (Sapphire)
  - `_getPrice()` dipanggil saat `processAction()` di Sapphire
  - `PrivateLendingIngress` di Mantle hanya handle escrow/release, tidak perlu oracle

**Catatan tentang Chainlink Feeds**:
- Jika Sapphire Testnet punya Chainlink feeds sendiri, gunakan address feeds di Sapphire
- Jika Sapphire tidak punya feeds (seperti sekarang), **pakai manual update** (Step 1.2)

### 1.1 Set Chainlink Feed untuk Token (di Sapphire) - OPSIONAL

**Skip step ini jika Sapphire belum punya Chainlink feeds.**

```bash
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0x... \  # atau 0x0 untuk native
CHAINLINK_FEED_ADDRESS=0x... \  # Chainlink aggregator address di Sapphire
npx hardhat run scripts/privatelending/service/setChainlinkFeed.ts --network sapphireTestnet
```

**Catatan**: 
- Feed address harus address Chainlink aggregator di **Sapphire Testnet**
- Jika Sapphire tidak punya feeds, gunakan manual update (lihat Step 1.2)
- Feed addresses bisa ditemukan di [Chainlink Data Feeds](https://docs.chainlink.com/data-feeds/price-feeds/addresses)

### 1.2 Update Price Manual (WAJIB untuk Testing)

**⚠️ Step ini WAJIB sebelum test supply/borrow**, karena health factor calculation butuh price.

Jika Sapphire tidak punya Chainlink feeds (seperti sekarang), gunakan manual update:

```bash
# Update price manual untuk native MNT (contoh: $0.5)
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0x0 \
MANUAL_PRICE=0.5 \  # Price dalam USD (akan di-parse sebagai 8 decimals: 50000000)
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet

# Update price untuk USDC (contoh: $1.0)
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9 \
MANUAL_PRICE=1.0 \
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet
```

**Catatan**: 
- `MANUAL_PRICE` akan di-parse sebagai 8 decimals (misal: `1.0` = `100000000`)
- Update price untuk semua token yang akan digunakan (minimal token untuk supply/borrow)
- Price harus di-update secara berkala (misal setiap 1 jam) untuk menghindari staleness
- Staleness threshold: 1 jam (configurable via `PRICE_STALENESS`)
- Untuk production, setup keeper/oracle service yang fetch price dari Mantle (atau chain lain) dan update ke Sapphire secara berkala

### 1.3 Update Price dari Chainlink (OPSIONAL - Jika Ada Feeds)

**Skip step ini jika Sapphire belum punya Chainlink feeds.**

```bash
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0x... \
USE_CHAINLINK=true \
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet
```

**Catatan**: 
- Hanya bisa digunakan jika Chainlink feeds sudah di-set di Step 1.1
- Chainlink feed otomatis di-cache di `LendingCore` dengan timestamp

---

## 2. Flow Release dari Sapphire ke Mantle

### 2.1 Alur Lengkap

```
┌─────────────┐
│   User      │
│  (Mantle)   │
└──────┬──────┘
       │
       │ 1. depositNative/depositErc20
       │    (amount visible di Mantle)
       ▼
┌─────────────────────┐
│ PrivateLendingIngress│
│     (Mantle)        │
└──────┬──────────────┘
       │
       │ 2. submitAction(depositId, ciphertext)
       │    (hanya encrypted hash visible)
       ▼
┌─────────────────────┐
│  Hyperlane Mailbox  │
│     (Mantle)        │
└──────┬──────────────┘
       │
       │ 3. Relayer forwards message
       ▼
┌─────────────────────┐
│  Hyperlane Mailbox  │
│    (Sapphire)       │
└──────┬──────────────┘
       │
       │ 4. _handle() stores encrypted action
       ▼
┌─────────────────────┐
│   LendingCore       │
│    (Sapphire)       │
└──────┬──────────────┘
       │
       │ 5. processAction(actionId)
       │    - Decrypt payload
       │    - Update indices (accrue interest)
       │    - Calculate health factor
       │    - Process action (supply/borrow/repay/withdraw/liquidate)
       │    - Validate health factor (untuk borrow/withdraw)
       │    - Dispatch release instruction jika perlu
       ▼
┌─────────────────────┐
│  Hyperlane Mailbox  │
│    (Sapphire)       │
└──────┬──────────────┘
       │
       │ 6. Relayer forwards release message
       ▼
┌─────────────────────┐
│  Hyperlane Mailbox  │
│     (Mantle)        │
└──────┬──────────────┘
       │
       │ 7. _handle() receives release instruction
       │    - Validate deposit ownership
       │    - Check liquidity availability
       │    - Release funds to receiver
       ▼
┌─────────────────────┐
│ PrivateLendingIngress│
│     (Mantle)        │
└──────┬──────────────┘
       │
       │ 8. Transfer funds (native/ERC20)
       ▼
┌─────────────┐
│   Receiver  │
│  (Mantle)   │
└─────────────┘
```

### 2.2 Proses di Sapphire (processAction)

Ketika `processAction(actionId)` dipanggil di Sapphire:

1. **Decrypt Payload**: Decrypt encrypted envelope menggunakan Sapphire.decrypt
2. **Update Indices**: Accrue interest untuk token (compound interest)
3. **Update User Indices**: Apply accrued interest ke user position
4. **Process Action**:
   - **SUPPLY**: Tambah collateral, update totalSupply
   - **BORROW**: Cek health factor >= 1.0, tambah borrow, dispatch release
   - **REPAY**: Kurangi borrow, update totalBorrow
   - **WITHDRAW**: Cek health factor setelah withdraw >= 1.0, kurangi collateral, dispatch release
   - **LIQUIDATE**: Cek health factor < 1.0, liquidator dapat collateral + bonus
5. **Dispatch Release**: Jika action memerlukan release (BORROW/WITHDRAW/LIQUIDATE), kirim message ke Mantle dengan format:
   ```
   (actionId, depositId, receiver, token, amount, isNative)
   ```

### 2.3 Release di Mantle (_handle)

Ketika `_handle()` menerima release instruction dari Sapphire:

1. **Validate Action**: Cek actionId exists, belum acknowledged, origin domain benar
2. **Validate Deposit**: Cek depositId belongs to receiver, belum released, type/token match
3. **Check Liquidity**: Cek available liquidity (deposited - reserved - borrowed) >= amount
4. **Release Funds**: 
   - Update deposit amount (remaining)
   - Update liquidity tracking (totalDeposited, totalReserved)
   - Transfer funds ke receiver (native atau ERC20)
5. **Emit Event**: Hanya encrypted data hash (minimal footprint)

---

## 3. Scripts untuk Proses Release

### 3.1 Process Action di Sapphire

Setelah user menjalankan `supply.ts`, `borrow.ts`, dll di Mantle, action akan tersimpan di Sapphire. Untuk memproses:

```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari event EncryptedActionStored atau script sebelumnya
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Output**:
- Action diproses (decrypt, validate, calculate HF)
- Release instruction dikirim ke Mantle (jika perlu)
- Processed payload info ditampilkan

### 3.2 Check Action Status

Untuk cek status action sebelum process:

```bash
# Menggunakan Hardhat console
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const action = await core.encryptedActions("0xACTION_ID")
> console.log("Processed:", action.processed)
> console.log("Origin Domain:", action.originDomain)
```

---

## 4. Health Factor & Oracle

### 4.1 Health Factor Calculation

Health Factor (HF) dihitung per token:

```
HF = (collateralValue * liquidationThreshold) / borrowValue

dimana:
- collateralValue = collateralAmount * price * liquidationThreshold / (PRICE_PRECISION * BPS)
- borrowValue = borrowAmount * price / PRICE_PRECISION
```

**Rules**:
- HF >= 1.0: User bisa borrow/withdraw
- HF < 1.0: User liquidatable
- HF = infinity: No borrow (safe)

### 4.2 Oracle Price Flow

1. **Chainlink Feed**: Set feed address untuk token via `setChainlinkFeed()`
2. **Update Price**: Panggil `updatePriceFromChainlink()` secara berkala (cron job atau keeper)
3. **Price Cache**: Price di-cache di `LendingCore` dengan timestamp
4. **Staleness Check**: Price dianggap invalid jika > 1 jam (configurable)
5. **Fallback**: Jika Chainlink unavailable, bisa update manual via `updatePrice()`

### 4.3 Price dalam Health Factor

Saat `processAction()` dipanggil:
- `_getPrice(token)` dipanggil untuk mendapatkan harga
- Jika cached price stale, coba fetch dari Chainlink (read-only)
- Jika Chainlink juga stale/unavailable, gunakan cached price (better than 0)
- Price digunakan untuk menghitung collateralValue dan borrowValue dalam HF

---

## 5. Liquidity Management

### 5.1 Reserve Buffer

Ingress mempertahankan reserve buffer (default 10%) untuk:
- Menjaga likuiditas saat banyak borrow bersamaan
- Mencegah over-borrowing
- Memastikan ada cukup dana untuk withdrawal

**Config**:
```bash
# Set reserve ratio (bps, e.g., 1000 = 10%)
npx hardhat console --network mantleSepolia
> const ingress = await ethers.getContractAt("PrivateLendingIngress", "0x...")
> await ingress.setReserveRatio(1000)  # 10%
```

### 5.2 Available Liquidity

Available liquidity = `totalDeposited - totalReserved - totalBorrowed`

**Check**:
```bash
npx hardhat console --network mantleSepolia
> const ingress = await ethers.getContractAt("PrivateLendingIngress", "0x...")
> const available = await ingress.getAvailableLiquidity("0xTOKEN")
> console.log("Available:", available.toString())
```

---

## 6. Contoh Flow Lengkap

### 6.1 Supply → Borrow → Repay → Withdraw

```bash
# 1. Setup (sekali)
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0x... \
CHAINLINK_FEED_ADDRESS=0x... \
npx hardhat run scripts/privatelending/service/setChainlinkFeed.ts --network sapphireTestnet

CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0x... \
USE_CHAINLINK=true \
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet

# 2. Supply
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
TOKEN_TYPE=erc20 TOKEN_ADDRESS=0x... TOKEN_DECIMALS=6 AMOUNT=100 \
npx hardhat run scripts/privatelending/service/supply.ts --network mantleSepolia
# Catat DEPOSIT_ID dari output

# 3. Process Supply di Sapphire
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari event EncryptedActionReceived
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet

# 4. Borrow (gunakan depositId dari supply sebagai collateral)
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
DEPOSIT_ID=0x... \
TOKEN_TYPE=erc20 TOKEN_ADDRESS=0x... TOKEN_DECIMALS=6 AMOUNT=50 \
npx hardhat run scripts/privatelending/service/borrow.ts --network mantleSepolia
# Catat ACTION_ID

# 5. Process Borrow di Sapphire
CORE_ADDRESS=0x... \
ACTION_ID=0x... \
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
# Release instruction dikirim ke Mantle, relayer akan forward
# User menerima borrowed funds di Mantle

# 6. Repay (deposit dulu, lalu submit action)
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
DEPOSIT_ID=0x... \  # Deposit baru untuk repay
TOKEN_TYPE=erc20 TOKEN_ADDRESS=0x... TOKEN_DECIMALS=6 AMOUNT=55 \  # Include interest
npx hardhat run scripts/privatelending/service/repay.ts --network mantleSepolia

# 7. Process Repay di Sapphire
CORE_ADDRESS=0x... \
ACTION_ID=0x... \
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet

# 8. Withdraw collateral
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
DEPOSIT_ID=0x... \  # DepositId dari supply awal
TOKEN_TYPE=erc20 TOKEN_ADDRESS=0x... TOKEN_DECIMALS=6 AMOUNT=50 \
npx hardhat run scripts/privatelending/service/withdraw.ts --network mantleSepolia

# 9. Process Withdraw di Sapphire
CORE_ADDRESS=0x... \
ACTION_ID=0x... \
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
# Release instruction dikirim, user menerima withdrawn funds
```

---

## 7. Troubleshooting

### 7.1 "health factor too low"
- **Cause**: User mencoba borrow/withdraw dengan HF < 1.0
- **Fix**: Supply lebih banyak collateral atau repay sebagian borrow

### 7.2 "insufficient liquidity"
- **Cause**: Available liquidity < amount yang diminta
- **Fix**: Tunggu lebih banyak supply atau kurangi amount

### 7.3 "price stale" atau "invalid price"
- **Cause**: Price tidak di-update dalam 1 jam atau Chainlink feed tidak set
- **Fix**: Update price via `updatePrice.ts` atau set Chainlink feed

### 7.4 "chainlink feed not set"
- **Cause**: Chainlink feed belum di-set untuk token
- **Fix**: Set feed via `setChainlinkFeed.ts` atau gunakan manual price update

---

## 8. Optimizer

Hardhat config sudah enable optimizer dengan `runs: 200` untuk mengurangi contract size:

```typescript
optimizer: {
  enabled: true,
  runs: 200, // Lower runs = smaller bytecode
}
```

Ini membantu mengurangi size `LendingCore` dari ~25KB menjadi lebih kecil, memenuhi 24KB limit.


