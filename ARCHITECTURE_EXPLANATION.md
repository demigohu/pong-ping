# Penjelasan Arsitektur Private Cross-Chain Transfer

Dokumen ini menjelaskan arsitektur sistem private cross-chain transfer yang menggabungkan **Mantle Sepolia** (public chain) dan **Oasis Sapphire** (confidential chain) menggunakan **Hyperlane** sebagai bridge.

---

## 🎯 Overview

Sistem ini memungkinkan transfer token (native MNT atau ERC20 seperti USDC) secara **private** dari Mantle ke recipient di Mantle, dengan proses dekripsi dan validasi terjadi di Sapphire yang confidential.

**Masalah yang diselesaikan:**
- Data sensitif (receiver address, amount, memo) tidak terlihat di blockchain publik
- Transfer tetap bisa diverifikasi dan auditable melalui transferId
- Kompatibel dengan token standar (native + ERC20)

---

## 🏗️ Komponen Utama

### 1. **Mantle Sepolia (Public Chain)**
Blockchain publik tempat user melakukan transfer. Semua data di sini **terlihat** oleh siapa saja.

#### Komponen di Mantle:
- **User Wallet (Sender)**: Wallet yang menginisiasi transfer
- **PrivateTransferIngress**: Smart contract yang:
  - Menerima deposit (MNT atau ERC20)
  - Menyimpan dana dalam escrow
  - Mengenkripsi payload (receiver, amount, memo) di client-side
  - Mengirim ciphertext ke Sapphire via Hyperlane
- **Hyperlane Mailbox (Mantle)**: Entry point untuk cross-chain messaging
- **Recipient Wallet (Receiver)**: Wallet yang menerima dana setelah release

### 2. **Oasis Sapphire (Confidential Chain)**
Blockchain dengan **Confidential EVM** dimana data dan eksekusi tetap **private**.

#### Komponen di Sapphire:
- **Hyperlane Mailbox (Sapphire)**: Entry point untuk menerima pesan dari Mantle
- **PrivateTransferVault**: Smart contract yang:
  - Menyimpan ciphertext dari Mantle
  - Mendekripsi payload menggunakan `Sapphire.decrypt` (confidential)
  - Membuat keputusan release berdasarkan data yang sudah di-dekripsi
  - Mengirim instruksi release kembali ke Mantle

### 3. **Hyperlane Relayer (Trusted Infrastructure)**
Infrastruktur yang **mengirim pesan** antara Mantle dan Sapphire.

- **Fungsi**: Menerima pesan dari Mailbox Mantle, mengirim ke Mailbox Sapphire (dan sebaliknya)
- **Trust Model**: Menggunakan `TrustedRelayerIsm` untuk membatasi siapa yang bisa memproses pesan
- **Gas Payment**: Relayer membayar gas fee untuk relay pesan

---

## 🔄 Alur Transfer (Step-by-Step)

### **Phase 1: Initiation (Mantle → Sapphire)**

#### Step 1: User Lock Funds
```
User Wallet → PrivateTransferIngress
```
- User memanggil `initiateNativeTransfer()` atau `initiateErc20Transfer()`
- Funds di-lock di kontrak Ingress (escrow)
- User menyediakan: `destinationDomain`, `ciphertext`, `depositAmount`

#### Step 2: Client-Side Encryption
```
User Wallet (off-chain) → Encrypt Payload
```
- **Payload yang dienkripsi**:
  ```solidity
  {
    receiver: address,    // Alamat penerima (PRIVATE)
    token: address,      // Token address (PRIVATE)
    amount: uint256,     // Jumlah (PRIVATE)
    isNative: bool,      // Native atau ERC20 (PRIVATE)
    memo: bytes          // Pesan opsional (PRIVATE)
  }
  ```
- **Enkripsi**: X25519 (key exchange) + Deoxys-II (symmetric encryption)
- **Public Key**: Diambil dari Vault di Sapphire (`vaultPublicKey()`)
- **Hasil**: Ciphertext yang tidak bisa dibaca tanpa secret key Vault

#### Step 3: Dispatch to Hyperlane
```
PrivateTransferIngress → Hyperlane Mailbox (Mantle)
```
- Kontrak Ingress memanggil `_Router_dispatch()`
- **Pesan yang dikirim**: `(transferId, ciphertext)`
- **Value**: 0 (relayer akan bayar gas via IGP)
- Event `PrivateTransferInitiated` di-emit (hanya `transferId`, tidak ada data sensitif)

#### Step 4: Relayer Picks Up Message
```
Hyperlane Mailbox (Mantle) → Hyperlane Relayer
```
- Relayer memantau Mailbox Mantle
- Ketika ada pesan baru untuk domain Sapphire, relayer mengambilnya
- Relayer memvalidasi pesan menggunakan ISM (Interchain Security Module)

#### Step 5: Relayer Delivers to Sapphire
```
Hyperlane Relayer → Hyperlane Mailbox (Sapphire)
```
- Relayer mengirim pesan ke Mailbox Sapphire
- Mailbox Sapphire memanggil `_handle()` di Vault

#### Step 6: Vault Stores Ciphertext
```
Hyperlane Mailbox (Sapphire) → PrivateTransferVault
```
- Vault menerima pesan: `(transferId, ciphertext)`
- Vault menyimpan `EncryptedTransfer` dengan:
  - `originDomain`: Mantle domain ID
  - `originRouter`: Address Ingress di Mantle
  - `envelope`: Ciphertext yang terenkripsi
- Event `EncryptedTransferStored` di-emit

---

### **Phase 2: Processing (Sapphire - Confidential)**

#### Step 7: Owner Calls processTransfer
```
Vault Owner → PrivateTransferVault.processTransfer(transferId)
```
- Owner Vault (yang punya secret key) memanggil `processTransfer()`
- Fungsi ini hanya bisa dipanggil oleh owner (access control)

#### Step 8: Decryption (Confidential)
```
PrivateTransferVault → Sapphire.decrypt()
```
- Vault menggunakan `Sapphire.decrypt()` untuk mendekripsi ciphertext
- **Ini terjadi di Confidential EVM** - plaintext tidak pernah terlihat oleh siapa pun
- **Hasil dekripsi**: `PrivatePayload` dengan receiver, token, amount, memo

#### Step 9: Build Release Instruction
```
PrivateTransferVault → Build Release Message
```
- Vault membangun pesan release:
  ```solidity
  (transferId, receiver, token, amount, isNative)
  ```
- Vault memanggil `_Router_dispatch()` untuk mengirim kembali ke Mantle
- Event `PrivatePayloadProcessed` di-emit (hanya di Sapphire, confidential)

---

### **Phase 3: Release (Sapphire → Mantle)**

#### Step 10: Relayer Relays Release Instruction
```
Hyperlane Mailbox (Sapphire) → Hyperlane Relayer → Hyperlane Mailbox (Mantle)
```
- Relayer mengambil pesan release dari Mailbox Sapphire
- Relayer mengirim ke Mailbox Mantle
- Mailbox Mantle memanggil `_handle()` di Ingress

#### Step 11: Ingress Validates & Releases
```
Hyperlane Mailbox (Mantle) → PrivateTransferIngress._handle()
```
- Ingress menerima pesan: `(transferId, receiver, token, amount, isNative)`
- **Validasi**:
  - Transfer ID ada di mapping
  - Origin domain sesuai (dari Sapphire)
  - Amount match dengan deposit
  - Token match dengan deposit
- Jika valid, Ingress melepaskan escrow:
  - **Native**: `receiver.call{value: amount}("")`
  - **ERC20**: `IERC20(token).safeTransfer(receiver, amount)`
- Event `PrivateTransferReleased` di-emit (hanya `transferId`, tidak ada data sensitif)

#### Step 12: Receiver Gets Funds
```
PrivateTransferIngress → Receiver Wallet
```
- Funds berhasil ditransfer ke receiver
- Transfer selesai

---

## 🔐 Privacy Guarantees

### Data yang TETAP Private (Tidak Terlihat di Mantle)

1. **Receiver Address** ✅
   - Hanya muncul sebagai ciphertext di Mantle
   - Hanya terlihat di Sapphire saat dekripsi

2. **Amount** ✅
   - Hanya muncul sebagai ciphertext di Mantle
   - Hanya terlihat di Sapphire saat dekripsi
   - **Catatan**: Untuk ERC20, event `Transfer` dari token contract masih terlihat (bagian dari standar ERC20)

3. **Memo** ✅
   - Sepenuhnya private, hanya di Sapphire

4. **Token Address** ✅
   - Hanya muncul sebagai ciphertext di Mantle
   - Hanya terlihat di Sapphire saat dekripsi

### Data yang Terlihat di Mantle (Public)

1. **TransferId** ✅
   - Public, digunakan untuk tracking
   - Tidak mengungkap data sensitif

2. **Sender Address** ✅
   - Public, karena user yang memanggil kontrak

3. **Ciphertext Hash** ✅
   - Hash dari ciphertext (untuk verifikasi)
   - Tidak bisa di-decode tanpa secret key

4. **ERC20 Transfer Event** ⚠️
   - Event `Transfer` dari kontrak ERC20 masih terlihat
   - Menampilkan: `from`, `to`, `value`
   - **Trade-off**: Bagian dari standar ERC20, tidak bisa dihindari

---

## 🛠️ Teknologi yang Digunakan

### 1. **Hyperlane Protocol**
- **Fungsi**: Cross-chain messaging protocol
- **Komponen**:
  - **Mailbox**: Entry point untuk mengirim/menerima pesan
  - **Router**: Wrapper untuk Mailbox dengan routing logic
  - **ISM (Interchain Security Module)**: Validasi pesan di destination chain
  - **Relayer**: Infrastructure yang mengirim pesan antar chain

### 2. **Oasis Sapphire**
- **Fungsi**: Confidential EVM untuk eksekusi private
- **Fitur**:
  - `Sapphire.decrypt()`: Dekripsi data dalam confidential context
  - `Sapphire.generateCurve25519KeyPair()`: Generate keypair untuk encryption
  - Storage dan execution tetap confidential

### 3. **Encryption (X25519 + Deoxys-II)**
- **X25519**: Key exchange untuk mendapatkan shared secret
- **Deoxys-II**: Symmetric encryption untuk mengenkripsi payload
- **Library**: `@oasisprotocol/sapphire-paratime`

### 4. **TrustedRelayerIsm**
- **Fungsi**: Membatasi siapa yang bisa memproses pesan
- **Implementasi**: Hanya relayer dengan address tertentu yang bisa memproses
- **Security**: Mencegah unauthorized relayer memproses pesan

---

## ⚖️ Trade-offs & Limitations

### ✅ Kelebihan

1. **Privacy untuk Data Sensitif**
   - Receiver, amount, memo tidak terlihat di Mantle
   - Dekripsi hanya terjadi di Sapphire (confidential)

2. **Compatibility**
   - Support native token dan ERC20
   - Menggunakan standar Hyperlane dan Sapphire

3. **Auditability**
   - TransferId bisa digunakan untuk tracking
   - Event logs tetap ada untuk monitoring

### ⚠️ Limitations

1. **ERC20 Transfer Events**
   - Event `Transfer` dari kontrak ERC20 masih terlihat
   - Solusi: Gunakan native token untuk privacy maksimal

2. **Trust Model**
   - Memerlukan trusted relayer
   - Vault owner harus dipercaya (untuk dekripsi)

3. **Gas Costs**
   - Relayer membayar gas untuk relay pesan
   - User membayar gas untuk initiate transfer

4. **Latency**
   - Transfer memerlukan waktu untuk relay (beberapa detik hingga menit)
   - Tergantung pada relayer dan network congestion

---

## 📊 Diagram Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    PHASE 1: INITIATION                      │
│                    (Mantle → Sapphire)                       │
└─────────────────────────────────────────────────────────────┘

User Wallet
    │
    ├─> Lock Funds (MNT/ERC20)
    │
    ├─> Encrypt Payload (Client-side)
    │   └─> X25519 + Deoxys-II
    │
    └─> PrivateTransferIngress
        │
        ├─> Store Deposit (Escrow)
        │
        └─> Dispatch Ciphertext
            │
            └─> Hyperlane Mailbox (Mantle)
                │
                └─> [Relayer] ──> Hyperlane Mailbox (Sapphire)
                    │
                    └─> PrivateTransferVault
                        └─> Store EncryptedTransfer

┌─────────────────────────────────────────────────────────────┐
│                    PHASE 2: PROCESSING                       │
│                    (Sapphire - Confidential)                │
└─────────────────────────────────────────────────────────────┘

Vault Owner
    │
    └─> processTransfer(transferId)
        │
        └─> PrivateTransferVault
            │
            ├─> Sapphire.decrypt() [CONFIDENTIAL]
            │   └─> Extract: receiver, token, amount, memo
            │
            └─> Build Release Instruction
                │
                └─> Dispatch to Mantle

┌─────────────────────────────────────────────────────────────┐
│                    PHASE 3: RELEASE                          │
│                    (Sapphire → Mantle)                      │
└─────────────────────────────────────────────────────────────┘

Hyperlane Mailbox (Sapphire)
    │
    └─> [Relayer] ──> Hyperlane Mailbox (Mantle)
        │
        └─> PrivateTransferIngress._handle()
            │
            ├─> Validate Release Instruction
            │
            └─> Release Escrow
                │
                └─> Receiver Wallet ✅
```

---

## 🎤 Poin Presentasi

### Slide 1: Problem Statement
- Transfer blockchain biasanya transparan (semua data terlihat)
- Perlu privacy untuk data sensitif (receiver, amount, memo)
- Tetap harus auditable dan verifiable

### Slide 2: Solution Overview
- Kombinasi public chain (Mantle) + confidential chain (Sapphire)
- Client-side encryption + confidential decryption
- Cross-chain messaging via Hyperlane

### Slide 3: Architecture Components
- Tiga layer: Mantle (public), Sapphire (confidential), Relayer (infrastructure)
- Komponen utama di setiap layer
- Trust model

### Slide 4: Flow Diagram
- Tunjukkan diagram Architecture.mmd
- Jelaskan 3 phase: Initiation, Processing, Release
- Highlight titik-titik privacy

### Slide 5: Privacy Guarantees
- Data apa yang private
- Data apa yang public
- Trade-offs (ERC20 events)

### Slide 6: Technology Stack
- Hyperlane untuk cross-chain
- Sapphire untuk confidential execution
- X25519 + Deoxys-II untuk encryption

### Slide 7: Demo / Results
- Tunjukkan transfer yang berhasil
- Bandingkan event logs sebelum/sesudah perbaikan
- Highlight bahwa data sensitif tidak terlihat

### Slide 8: Conclusion
- Privacy untuk cross-chain transfer
- Compatible dengan token standar
- Trade-offs yang wajar

---

## 📝 Catatan untuk Presentasi

1. **Emphasize Privacy**: Tekankan bahwa data sensitif tidak pernah muncul sebagai plaintext di Mantle
2. **Show Encryption**: Jelaskan bahwa enkripsi terjadi di client-side sebelum dikirim ke blockchain
3. **Confidential Execution**: Tekankan bahwa dekripsi hanya terjadi di Sapphire yang confidential
4. **Trade-offs**: Jujur tentang ERC20 Transfer events yang masih terlihat
5. **Use Cases**: Sebutkan use case seperti private payroll, confidential donations, dll

---

**Selamat presentasi! 🚀**



