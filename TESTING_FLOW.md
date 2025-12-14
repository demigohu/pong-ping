# Testing Flow Lengkap - Private Lending

Dokumen ini menjelaskan flow testing lengkap dari awal hingga akhir untuk Private Lending Protocol.

---

## 📋 Prasyarat

1. **Contracts sudah deployed** (lihat `DEPLOYMENT_FLOW.md`)
2. **Routers sudah enrolled** (Mantle ↔ Sapphire)
3. **ISM sudah registered**
4. **Relayer Hyperlane aktif** untuk forward messages

---

## 🔧 Setup Awal (Sekali)

### 1. Configure Token di LendingCore (Sapphire)

**⚠️ WAJIB**: Setiap token yang akan digunakan **harus di-configure dulu** sebelum bisa digunakan untuk supply/borrow.

```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> await core.configureToken(
    "0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080",  // token address
    7500,       // LTV (75%)
    8000,       // liquidation threshold (80%)
    1000,       // borrow rate (10% APR)
    500         // supply rate (5% APR)
  )
```

**Catatan**:
- **Aave juga pakai token config** - setiap token punya LTV, liquidation threshold, dan rates sendiri
- Config ini menentukan:
  - Berapa % bisa borrow dari collateral (LTV)
  - Kapan bisa diliquidate (liquidation threshold)
  - Berapa bunga untuk supply/borrow (rates)

### 2. Setup Oracle Price

**Opsi A: Manual Update (Untuk Testing)**

```bash
CORE_ADDRESS=0x... \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
MANUAL_PRICE=1.0 \  # Price dalam USD (8 decimals)
npx hardhat run scripts/privatelending/service/updatePrice.ts --network sapphireTestnet
```

**Opsi B: ROFL Oracle (Production - Recommended)**

Chainlink tidak tersedia di Oasis Sapphire. Gunakan **ROFL Oracle** sebagai alternatif:

1. **Deploy ROFL Oracle Contract** (lihat [Oasis Docs](https://docs.oasis.io/build/use-cases/price-oracle/))
2. **Deploy ROFL Worker** yang fetch price dari exchange (Binance, dll)
3. **Update price** dari ROFL oracle ke `LendingCore`

**Catatan**: 
- ROFL oracle menggunakan `Subcall.roflEnsureAuthorizedOrigin()` untuk autentikasi
- Worker berjalan di container dan submit observation ke contract
- Contract melakukan aggregation dan update price

Untuk sekarang, gunakan manual update untuk testing.

---

## 🧪 Flow Testing Lengkap

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

**Output**:
```
Deposit erc20 ok. depositId=0x...
✅ Action ID: 0x...
To process this action on Sapphire, run:
CORE_ADDRESS=0x... ACTION_ID=0x... npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Catat**: `DEPOSIT_ID` dan `ACTION_ID`

---

### Step 2: Process Supply di Sapphire

```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari Step 1
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Output**:
```
✅ Action processed! Release instruction dispatched in tx 0x...
=== Processed Action Info ===
Action Type: 0 (SUPPLY)
Token: 0xAcab...
Amount: 100000000
On Behalf: 0x...
Deposit ID: 0x...
```

**Verifikasi**:
```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const pos = await core.positions("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> pos
# Harusnya: collateral > 0, borrow = 0
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

**Catat**: `ACTION_ID` dari output

---

### Step 5: Process Borrow di Sapphire

```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \  # Dari Step 4
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Output**:
```
✅ Action processed! Release instruction dispatched in tx 0x...
=== Processed Action Info ===
Action Type: 1 (BORROW)
Amount: 50000000
```

**Verifikasi**:
```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const pos = await core.positions("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> pos
# Harusnya: collateral > 0, borrow > 0
> await core.calculateHealthFactorForToken("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
# Harusnya: HF >= 1.0 (1000000000000000000)
```

**Catatan**: 
- Release instruction akan dikirim ke Mantle
- Relayer akan forward message
- User akan menerima borrowed funds di Mantle

---

### Step 6: Repay (Bayar Pinjaman)

**Tujuan**: User bayar sebagian atau semua borrow.

**Deposit dulu untuk repay**:
```bash
INGRESS_ADDRESS=0x... \
TOKEN_TYPE=erc20 \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
TOKEN_DECIMALS=6 \
AMOUNT=55 \  # Include interest
npx hardhat run scripts/privatelending/service/deposit.ts --network mantleSepolia
```

**Catat**: `DEPOSIT_ID` baru

**Submit repay action**:
```bash
INGRESS_ADDRESS=0x... \
LENDING_PUBLIC_KEY=0x... \
DEPOSIT_ID=0x... \  # Deposit ID baru
TOKEN_TYPE=erc20 \
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080 \
TOKEN_DECIMALS=6 \
AMOUNT=55 \
npx hardhat run scripts/privatelending/service/repay.ts --network mantleSepolia
```

**Process di Sapphire**:
```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \
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

**Process di Sapphire**:
```bash
CORE_ADDRESS=0x... \
ACTION_ID=0x... \
npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet
```

**Verifikasi**: 
- Collateral berkurang
- HF tetap >= 1.0
- Release instruction dikirim ke Mantle
- User menerima withdrawn funds

---

## 🔍 Verifikasi State

### Cek User Position

```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const pos = await core.positions("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> console.log("Collateral:", pos.collateral.toString())
> console.log("Borrow:", pos.borrow.toString())
```

### Cek Health Factor

```bash
> await core.calculateHealthFactorForToken("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
# HF = (collateralValue * liquidationThreshold) / borrowValue
# HF >= 1.0 = safe
# HF < 1.0 = liquidatable
```

### Cek Token Config

```bash
> const config = await core.tokenConfigs("0xTOKEN_ADDRESS")
> console.log("Enabled:", config.enabled)
> console.log("LTV:", config.ltv.toString(), "bps")
> console.log("Total Supply:", config.totalSupply.toString())
> console.log("Total Borrow:", config.totalBorrow.toString())
```

### Cek Price

```bash
> const price = await core.prices("0xTOKEN_ADDRESS")
> console.log("Price:", price.price.toString(), "(8 decimals)")
> console.log("Timestamp:", new Date(Number(price.timestamp) * 1000).toISOString())
> console.log("Valid:", price.valid)
```

---

## ❓ FAQ

### Q: Apakah token harus di-setting config seperti Aave?

**A: Ya, WAJIB!** 

- **Aave juga pakai token config** - setiap token punya:
  - LTV (Loan-to-Value)
  - Liquidation threshold
  - Interest rates (supply/borrow)
  - Reserve factor
  
- **Di kita juga sama**:
  - `configureToken()` harus dipanggil sebelum token bisa digunakan
  - Setiap token punya config sendiri
  - Config menentukan batas borrow, liquidation, dan rates

**Perbedaan dengan Aave**:
- Aave: Config di-set saat deploy atau via governance
- Kita: Config di-set manual via `configureToken()` (bisa diotomasi dengan governance nanti)

### Q: Chainlink tidak ada di Oasis, pakai apa?

**A: Pakai ROFL Oracle** (Recommended) atau Manual Update (Testing)

**ROFL Oracle**:
- Menggunakan [ROFL (Remote Oracle Function Layer)](https://docs.oasis.io/build/use-cases/price-oracle/)
- Worker berjalan di container, fetch price dari exchange
- Submit observation ke contract dengan autentikasi `Subcall.roflEnsureAuthorizedOrigin()`
- Contract aggregate observations dan update price

**Manual Update** (untuk testing):
- Fetch price dari exchange/API
- Update manual via `updatePrice()`

**Chainlink**:
- Tidak tersedia di Oasis Sapphire
- Tapi bisa pakai Chainlink di chain lain (Mantle) dan forward price via Hyperlane (lebih kompleks)

### Q: Apakah price harus di-update berkala?

**A: Ya, WAJIB!**

- Price digunakan untuk health factor calculation
- Jika price stale (> 1 jam), health factor akan invalid
- Untuk production, setup:
  - **ROFL Oracle** yang update otomatis setiap X menit
  - Atau **Keeper service** yang fetch dari exchange dan update ke Sapphire

### Q: Bagaimana flow release dari Sapphire ke Mantle?

**A: Otomatis via Hyperlane**

1. `processAction()` di Sapphire → dispatch release instruction
2. Relayer Hyperlane forward message Sapphire → Mantle
3. `_handle()` di Ingress Mantle → validate & release funds
4. User menerima funds

**Tidak perlu manual action** - semua otomatis setelah `processAction()` sukses.

---

## 🐛 Troubleshooting

### "token not enabled"
- **Fix**: Run `configureToken()` untuk token tersebut

### "health factor too low"
- **Fix**: Supply lebih banyak collateral atau repay sebagian borrow

### "price stale" atau "invalid price"
- **Fix**: Update price via `updatePrice.ts` atau setup ROFL oracle

### "insufficient liquidity"
- **Fix**: Pastikan ada cukup supply di pool, atau kurangi amount borrow/withdraw

### "action not found" saat processAction
- **Fix**: Pastikan relayer sudah forward message dari Mantle ke Sapphire

---

## 📚 References

- [ROFL Price Oracle](https://docs.oasis.io/build/use-cases/price-oracle/)
- [Aave Token Configuration](https://docs.aave.com/developers/core-contracts/pool#getreservedata)
- `DEPLOYMENT_FLOW.md` - Setup deployment
- `PRIVATE_LENDING_FLOW.md` - Flow detail

