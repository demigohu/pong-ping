# Private Transfer Mantle ↔ Sapphire (OPL + Hyperlane)

Panduan ini menjelaskan cara menjalankan alur private transfer menggunakan kombinasi Mantle Sepolia (kontrak publik) dan Sapphire Testnet (kontrak privat). Seluruh kode sudah ada di repo ini.

## 0. Prasyarat
- Node.js ≥ 18, Hardhat + paket dev sudah terpasang.
- `.env` berisi:
  - `PRIVATE_KEY`
  - `MANTLE_SEPOLIA_RPC`, `SAPPHIRE_TESTNET_RPC`
  - `MANTLE_MAILBOX`, `SAPPHIRE_MAILBOX`
- (Opsional) `VAULT_PUBLIC_KEY` untuk menyimpan hasil query public key Vault sehingga klien bisa mengenkripsikan payload tanpa mengambilnya ulang dari jaringan.
- Relayer Hyperlane siap berjalan untuk domain Mantle (5003) ↔ Sapphire (23295). Lihat panduan relayer Hyperlane [[docs.oasis.io](https://docs.oasis.io/build/opl/hyperlane/)].

## 1. Komponen Kontrak
- `contracts/privatetransfer/PrivateTransferIngress.sol`
  - Deploy di Mantle Sepolia.
  - Menyimpan metadata transfer & meneruskan ciphertext lewat Hyperlane.
- `contracts/privatetransfer/PrivateTransferVault.sol`
  - Deploy di Sapphire Testnet.
  - Menyimpan ciphertext, mendekripsi secara privat dengan kunci rahasia, dan mengirim acknowledgement balik.

## 2. Deploy Kontrak Router
```bash
# Mantle ingress
MANTLE_MAILBOX=0x598f... \
npx hardhat run scripts/privatetransfer/deploy/deployIngress.ts --network mantleSepolia

# Sapphire vault (kunci disiapkan otomatis oleh Sapphire)
SAPPHIRE_MAILBOX=0x79d3... \
npx hardhat run scripts/privatetransfer/deploy/deployVault.ts --network sapphireTestnet

# Deploy ISM di Mantle
MAILBOX=$MANTLE_MAILBOX TRUSTED_RELAYER=<RELAYER> \
npx hardhat run scripts/privatetransfer/deploy/deployISM.ts --network mantleSepolia
```
Catat alamat hasil deploy sebagai `INGRESS` dan `VAULT`.

## 3. Enroll Router Hyperlane
```bash
# Mantle: arahkan domain Sapphire ke Vault
INGRESS_ADDRESS=<INGRESS> \
VAULT_ADDRESS=<VAULT> \
SAPPHIRE_DOMAIN=23295 \
npx hardhat run scripts/privatetransfer/enroll/enrollIngress.ts --network mantleSepolia

# Sapphire: arahkan domain Mantle ke Ingress
INGRESS_ADDRESS=<INGRESS> \
VAULT_ADDRESS=<VAULT> \
MANTLE_DOMAIN=5003 \
npx hardhat run scripts/privatetransfer/enroll/enrollVault.ts --network sapphireTestnet

# Daftarkan ISM ke Ingress (router Mantle)
ROUTER_ADDRESS=<INGRESS_ADDRESS> \
ISM_ADDRESS=<ISM_MANTLE> \
npx hardhat run scripts/privatetransfer/enroll/registerIsm.ts --network mantleSepolia
```

## 4. Pasang TrustedRelayerIsm (opsional tapi direkomendasikan)
Mengacu tutorial ping-pong Oasis, cukup pasang TrustedRelayerIsm di **Mantle** (chain publik yang menerima pesan balik).

Vault di Sapphire bisa tetap memakai ISM default. Jika ingin membatasi arah Sapphire → Mantle juga, ulangi langkah di atas pada Sapphire, tapi minimal requirement dari docs Oasis hanya di Mantle [[1](https://docs.oasis.io/build/opl/hyperlane/pingpong-example)].

## 5. Jalankan Relayer
Di shell terpisah:
```bash
export HYP_KEY=<PRIVATE_KEY>
hyperlane relayer --chains mantlesepolia,sapphiretestnet
```
Relayer wajib hidup selama kamu ingin pesan lintas chain berjalan.

## 6. Ambil Public Key Vault
Vault otomatis membuat keypair Curve25519 di Sapphire. Kamu perlu public key‑nya untuk mengenkripsi pesan.

```bash
VAULT_ADDRESS=<VAULT> \
npx hardhat run scripts/privatetransfer/service/getVaultPublicKey.ts --network sapphireTestnet
```
Simpan output `Vault public key: 0x...` ke `.env` sebagai `VAULT_PUBLIC_KEY`.

## 7. Kirim Private Transfer dari Mantle (lock dana + enkripsi otomatis)
`scripts/privatetransfer/service/requestTransfer.ts` kini melakukan:
1. **Mengunci dana**  
   - `TOKEN_TYPE=native` → mengirim MNT (18 desimal).  
   - `TOKEN_TYPE=erc20` → mengirim ERC20 (default 6 desimal untuk USDC), otomatis `approve` jika allowance kurang.
2. **Mengenkripsi payload** `(receiver, token, amount, isNative, memo)` memakai `VAULT_PUBLIC_KEY` via X25519+Deoxys-II.
3. **Dispatch Hyperlane** ke Sapphire.

Contoh env (semua dalam satu baris perintah):
```bash
INGRESS_ADDRESS=0x6Ff7032324dCf4026D28013e605F78B485a81F8e \
VAULT_PUBLIC_KEY=0xaefda5e647f6262d1c3917b4628a2203d4aa4d2cfb0ed14626b0113c4f204333 \
RECEIVER=0x<alamat_penerima> \
AMOUNT=10 \
TOKEN_TYPE=native \
TOKEN_DECIMALS=18 \
DISPATCH_GAS_FEE=0.0005 \
TESTER_PRIVATE_KEY=0x<opsional: PK pengirim khusus> \
npx hardhat run scripts/privatetransfer/service/requestTransfer.ts --network mantleSepolia
```

**⚠️ PENTING**: 
- `AMOUNT=10` berarti 10 MNT (bukan wei)
- Pastikan semua env vars diset dalam satu baris perintah (gunakan `\` untuk line continuation)
- Atau export di shell terlebih dahulu:
```bash
export INGRESS_ADDRESS=0x6Ff7032324dCf4026D28013e605F78B485a81F8e
export VAULT_PUBLIC_KEY=0xaefda5e647f6262d1c3917b4628a2203d4aa4d2cfb0ed14626b0113c4f204333
export RECEIVER=0x<alamat_penerima>
export AMOUNT=10
export TOKEN_TYPE=native
export TOKEN_DECIMALS=18
export DISPATCH_GAS_FEE=0.0005   # Opsional; kontrak tetap dispatch dengan value 0
export TESTER_PRIVATE_KEY=0x<opsional: gunakan akun pengirim lain>
npx hardhat run scripts/privatetransfer/service/requestTransfer.ts --network mantleSepolia
```
> Jika `TESTER_PRIVATE_KEY` (atau `PRIVATE_KEY_2` / `SENDER_PRIVATE_KEY`) di-set, skrip akan membuat wallet baru dan hanya transaksi pengiriman yang memakai akun tersebut; deployer/relayer tetap menggunakan `PRIVATE_KEY` utama.
Kontrak Ingress hanya menyimpan ciphertext + escrow; data sensitif tetap terenkripsi.

## 7. Proses & Rilis di Sapphire
Begitu relayer mengirim pesan ke Sapphire, kamu perlu `TRANSFER_ID` untuk memproses transfer.

### Cara Mendapatkan TRANSFER_ID
`TRANSFER_ID` adalah identifier unik (bytes32) yang dibuat saat transfer dimulai. Kamu bisa mendapatkannya dari:

1. **Event logs di Explorer Mantle** (paling mudah):
   - Buka transaksi di [Mantle Sepolia Explorer](https://sepolia.mantlescan.xyz)
   - Scroll ke bagian **"Logs"** atau **"Events"**
   - Cari event `PrivateTransferInitiated`
   - Di event tersebut, ada field `transferId` (bytes32) — **ini adalah TRANSFER_ID**
   - Copy nilai hex-nya (contoh: `0x1234...abcd`)

   Atau via Hardhat console:
   ```bash
   npx hardhat console --network mantleSepolia
   > const ingress = await ethers.getContractAt("PrivateTransferIngress", "<INGRESS>");
   > const filter = ingress.filters.PrivateTransferInitiated();
   > const events = await ingress.queryFilter(filter, "latest" - 10, "latest");
   > events[0].args.transferId; // Ini TRANSFER_ID-nya
   ```

   **Catatan**: Parameter `[0]` di input function (`0x5aff` = 23295) adalah `destinationDomain` (Sapphire), bukan TRANSFER_ID. TRANSFER_ID ada di event logs, bukan di input parameters.

2. **Return value** dari `requestTransfer.ts` (jika script dimodifikasi untuk print transferId).

3. **Dari event di Sapphire**: Setelah relayer sukses, event `EncryptedTransferStored` di Sapphire juga mengandung `transferId`.

Setelah mendapat `TRANSFER_ID`, **pastikan relayer sudah mengirim pesan ke Sapphire** (cek log relayer untuk konfirmasi sukses).

Kemudian, cek status transfer terlebih dahulu:
```bash
VAULT_ADDRESS=<VAULT> \
TRANSFER_ID=0x<transferId> \
npx hardhat run scripts/privatetransfer/service/checkTransfer.ts --network sapphireTestnet
```

Script ini akan menampilkan:
- Apakah transfer sudah ada di Vault
- Apakah transfer sudah diproses
- Apakah signer adalah owner Vault

Jika transfer sudah ada dan belum diproses, jalankan:
```bash
VAULT_ADDRESS=<VAULT> \
TRANSFER_ID=0x<transferId> \
ACK_GAS_FEE=0 \
npx hardhat run scripts/privatetransfer/service/ackTransfer.ts --network sapphireTestnet
```
> Selama Vault belum memakai Interchain Gas Paymaster, `ACK_GAS_FEE` **harus 0** karena `_Router_dispatch` di Sapphire selalu dikirim tanpa value. Jika ingin membayar gas destinasi lewat IGP, set hook + `payForGas` terlebih dahulu baru izinkan value di sini.
Skrip tersebut memanggil `PrivateTransferVault.processTransfer`, yang:
- Mendekripsi payload dengan `Sapphire.decrypt`.
- Mengirim instruksi rilis (receiver, token, amount, tipe) kembali ke Mantle.
- Menyimpan payload terdekripsi di `processedPayloads` untuk audit.

## 8. Dana Dirilis di Mantle
Setelah pesan balik tiba, Ingress akan:
- Validasi data terhadap escrow.
- Mengirim MNT native atau ERC20 ke `receiver`.
- Emit `PrivateTransferAcknowledged` + `PrivateTransferReleased`.

Semua log rilis bisa dipantau melalui Hardhat console atau explorer Mantle.

## 9. Monitoring & Testing
- Mantle: event `PrivateTransferInitiated` / `PrivateTransferAcknowledged`.
- Sapphire: event `EncryptedTransferStored` / `TransferAcknowledged`.
- Pastikan RPC Mantle yang dipakai mendukung `eth_getLogs` range kecil (skrip verifikasi sudah memakai window 5 blok).

## 10. Troubleshooting

### Error: "Transfer not found in Vault"
**Penyebab**: Pesan dari Mantle belum sampai ke Sapphire.

**Solusi**:
1. Pastikan relayer Hyperlane sedang berjalan dan memantau kedua chain.
2. Cek log relayer untuk melihat apakah pesan sudah di-relay:
   ```
   Observed message 0x... on mantlesepolia to sapphiretestnet
   Relaying message 0x...
   ```
3. Tunggu beberapa detik/menit sampai relayer selesai mengirim pesan.
4. Jalankan `checkTransfer.ts` lagi untuk memverifikasi.

### Error: "transaction execution reverted" saat ackTransfer
**Penyebab**:
- Transfer belum ada di Vault (relayer belum relay)
- TRANSFER_ID salah
- Signer bukan owner Vault
- Transfer sudah diproses
- Payload tidak bisa di-decode (format tidak sesuai)

**Solusi**:
1. Jalankan `checkTransfer.ts` untuk melihat status transfer.
2. Pastikan kamu menggunakan `PRIVATE_KEY` yang sama dengan owner Vault (yang deploy Vault).
3. Verifikasi `TRANSFER_ID` dari event logs di Mantle explorer.
4. Pastikan relayer sudah mengirim pesan (lihat log relayer).
5. Jika payload tidak bisa di-decode, pastikan format payload di `requestTransfer.ts` sesuai dengan `PrivatePayload` struct.

### Error: "MerkleTreeHook: no value expected"
**Penyebab**: Hook di Mailbox tidak menerima value.

**Solusi**: Sudah diperbaiki di kontrak terbaru (selalu kirim value 0). Pastikan kamu menggunakan kontrak yang sudah di-redeploy.

## 11. Privacy Limitations & Trade-offs

### Data yang TETAP Terlihat di Mantle (Public Chain)

Meskipun kontrak sudah di-update untuk tidak mem-publish data sensitif di event logs, beberapa informasi masih bisa terlihat:

1. **ERC20 Transfer Events** (Tidak Bisa Dihindari)
   - Event `Transfer` dari kontrak ERC20 (misalnya USDC) akan tetap muncul di logs
   - Menampilkan: `from` (Ingress contract), `to` (receiver), `value` (amount)
   - **Alasan**: Ini adalah bagian dari standar ERC20 dan tidak bisa diubah tanpa memodifikasi kontrak token itu sendiri
   - **Solusi**: Untuk privacy maksimal, pertimbangkan menggunakan native token (MNT) atau token custom yang tidak emit event

2. **Native Transfer Balance Changes**
   - Perubahan balance di address receiver tetap terlihat di blockchain
   - **Alasan**: Blockchain adalah public ledger, semua balance changes terlihat
   - **Solusi**: Tidak ada solusi teknis untuk ini di level smart contract

3. **Event `PrivateTransferInitiated`** (Sudah Diperbaiki)
   - ✅ Sekarang hanya emit: `transferId`, `sender`, `destinationDomain`, `ciphertextHash`
   - ❌ Tidak lagi emit: `token`, `amount`, `isNative`

4. **Event `PrivateTransferReleased`** (Sudah Diperbaiki)
   - ✅ Sekarang hanya emit: `transferId`
   - ❌ Tidak lagi emit: `receiver`, `token`, `amount`, `isNative`

### Data yang TETAP Private

1. **Receiver Address** - Hanya terlihat di Sapphire (confidential execution)
2. **Amount** - Hanya terlihat di Sapphire (kecuali untuk ERC20 Transfer event)
3. **Memo** - Sepenuhnya private, hanya di Sapphire
4. **Ciphertext Content** - Tidak bisa di-decode tanpa secret key Vault

### Rekomendasi untuk Privacy Maksimal

- **Gunakan Native Token (MNT)** untuk menghindari ERC20 Transfer events
- **Gunakan Multiple Intermediate Addresses** untuk memecah link on-chain
- **Pertimbangkan Mixing Layer** tambahan jika diperlukan privacy level yang lebih tinggi

## 12. Catatan Penting
- Mantle tetap publik; semua enkripsi terjadi di klien menggunakan public key Vault, jadi plaintext tidak pernah muncul di Mantle.
- Vault menyimpan secret key Curve25519 di Sapphire (confidential) dan otomatis memanfaatkan `Sapphire.decrypt`.
- Gunakan `TOKEN_DECIMALS` yang benar (contoh: USDC Mantle Sepolia = 6) agar jumlah yang dikunci sama dengan jumlah yang dirilis.
- **Event logs sudah di-update untuk tidak mem-publish data sensitif**, namun ERC20 Transfer events tetap terlihat karena bagian dari standar token.
- Dokumentasi umum OPL & Hyperlane: [[docs.oasis.io](https://docs.oasis.io/build/opl/)], [[docs.oasis.io/hyperlane](https://docs.oasis.io/build/opl/hyperlane/)].

---

## 13. Withdraw Pattern (Seperti Umbra - Bukan Transfer Langsung!)

**PENTING**: Implementasi sekarang menggunakan **withdraw pattern** yang membuat transfer terlihat seperti **deposit/withdraw** bukan **transfer langsung**, mirip dengan Umbra's private payment approach.

### Cara Kerja:

1. **Sender deposit** ke Ingress contract (terlihat seperti deposit biasa)
2. **Sapphire decrypt** dan store funds untuk withdrawal (tidak langsung transfer)
3. **Receiver withdraw** dari contract (terlihat seperti withdraw biasa)

**Keuntungan:**
- ✅ Transfer tidak terlihat seperti "kirim ke receiver"
- ✅ Terlihat seperti deposit/withdraw pattern
- ✅ Tidak ada link langsung antara deposit dan withdraw
- ✅ Mirip dengan Umbra's private payment

### Check Pending Withdrawals:

```bash
# INGRESS_ADDRESS=<MANTLE_INGRESS>
# RECEIVER=<RECEIVER_ADDRESS>
npx hardhat run scripts/privatetransfer/service/checkPendingWithdrawals.ts --network mantleSepolia
```

### Withdraw Funds:

```bash
# INGRESS_ADDRESS=<MANTLE_INGRESS>
# WITHDRAW_INDEX=0
# TESTER_PRIVATE_KEY=<RECEIVER_PRIVATE_KEY>
npx hardhat run scripts/privatetransfer/service/withdraw.ts --network mantleSepolia
```

---

Dengan alur ini, alamat/amount sensitif tidak pernah muncul di chain publik Mantle **melalui event logs kontrak kita**. Mantle hanya menampung ciphertext dan status. Eksekusi & penyimpanan data privat sepenuhnya terjadi di Sapphire melalui Oasis Privacy Layer.

**Plus**, dengan withdraw pattern, transfer tidak terlihat seperti transfer langsung, melainkan seperti deposit/withdraw biasa, mirip dengan Umbra's private payment approach! 🚀



