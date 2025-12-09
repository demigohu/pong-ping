# Signature Verification Pattern - Minimal On-Chain Footprint (Seperti Umbra)

## 🎯 Tujuan

Membuat transfer di Mantle terlihat seperti **"signature verification record"** bukan transfer, sehingga:
- ✅ Transaction terlihat hanya seperti signature hash dan timestamp
- ✅ Minimal on-chain footprint - hanya signature verification record
- ✅ Tidak terlihat seperti transfer, deposit, atau withdraw
- ✅ Mirip dengan Umbra's approach dimana transaction terlihat sangat minimal
- ✅ Computation tetap terjadi di Oasis (Sapphire) - confidential

---

## 🔄 Pattern yang Diterapkan

### Pattern Saat Ini (Minimal On-Chain Footprint):

```
Mantle (Public):
  - Event: SignatureVerified(signatureHash, timestamp) ✅
  - Event: SignatureAcknowledged(signatureHash) ✅
  - Event: WithdrawalReady(signatureHash, timestamp) ✅
  - Event: WithdrawalCompleted(signatureHash, timestamp) ✅
  
  Terlihat seperti: Signature verification records, bukan transfer!

Oasis Sapphire (Confidential):
  - Decrypt payload (confidential)
  - Process transfer (confidential)
  - Build release instruction (confidential)
```

**Keuntungan:**
- ✅ Di Mantle hanya terlihat signature hash dan timestamp
- ✅ Tidak ada receiver address, amount, atau token address yang terlihat
- ✅ Terlihat seperti signature verification record, bukan transfer
- ✅ Computation tetap di Oasis (confidential)

---

## 🛠️ Implementasi

### 1. Event Logs (Minimal Footprint)

Semua event sekarang hanya emit **signature hash** dan **timestamp**:

```solidity
// ✅ Looks like signature verification, not transfer
event SignatureVerified(
    bytes32 indexed signatureHash,
    uint256 timestamp
);

event SignatureAcknowledged(
    bytes32 indexed signatureHash
);

event WithdrawalReady(
    bytes32 indexed signatureHash,
    uint256 timestamp
);

event WithdrawalCompleted(
    bytes32 indexed signatureHash,
    uint256 timestamp
);
```

### 2. Signature Hash Generation

Signature hash di-generate dari:
- **Initiate**: `keccak256(transferId, keccak256(ciphertext))`
- **Acknowledge**: `keccak256(transferId, receiver)`
- **Withdraw**: `keccak256(transferId, receiver)`

Ini membuat signature hash unik untuk setiap transfer, tapi tidak reveal data sensitif.

### 3. On-Chain Footprint

**Di Mantle (Public Chain):**
- ✅ Hanya signature hash dan timestamp yang terlihat
- ✅ Tidak ada receiver address, amount, atau token address
- ✅ Terlihat seperti signature verification record
- ✅ Minimal on-chain footprint

**Di Oasis (Confidential Chain):**
- ✅ Decrypt payload (confidential)
- ✅ Process transfer (confidential)
- ✅ Build release instruction (confidential)
- ✅ Semua computation terjadi di confidential environment

---

## 🎯 Keuntungan Pattern Ini

### 1. **Minimal On-Chain Footprint**
- ✅ Hanya signature hash dan timestamp yang terlihat di Mantle
- ✅ Tidak ada data sensitif yang terlihat
- ✅ Terlihat seperti signature verification record, bukan transfer

### 2. **Privacy Maksimal**
- ✅ Receiver address tidak terlihat di event logs
- ✅ Amount tidak terlihat di event logs
- ✅ Token address tidak terlihat di event logs
- ✅ Hanya signature hash dan timestamp

### 3. **Mirip Umbra**
- ✅ Transaction terlihat sangat minimal (hanya signature + timestamp)
- ✅ Tidak terlihat seperti transfer, deposit, atau withdraw
- ✅ Computation tetap di confidential environment (Oasis)

### 4. **Computation di Oasis**
- ✅ Semua decrypt dan processing terjadi di Oasis (confidential)
- ✅ Mantle hanya menyimpan signature verification records
- ✅ Mirip dengan Umbra yang computation di Arcium (confidential)

---

## 📊 Perbandingan

### Umbra (Solana + Arcium):
```
Solana (Public):
  - Encrypted transaction instructions
  - Minimal on-chain footprint
  
Arcium (Confidential):
  - MPC computation
  - Decrypt and process
```

### Implementasi Kita (Mantle + Oasis):
```
Mantle (Public):
  - Signature hash + timestamp (signature verification records)
  - Minimal on-chain footprint
  
Oasis Sapphire (Confidential):
  - Confidential EVM computation
  - Decrypt and process
```

**Kesamaan:**
- ✅ Minimal on-chain footprint di public chain
- ✅ Computation di confidential environment
- ✅ Transaction terlihat sangat minimal

---

## ⚠️ Trade-offs

### Keuntungan:
- ✅ Minimal on-chain footprint (hanya signature + timestamp)
- ✅ Privacy maksimal (tidak ada data sensitif di event logs)
- ✅ Terlihat seperti signature verification, bukan transfer
- ✅ Mirip dengan Umbra's approach

### Kekurangan:
- ⚠️ Signature hash tidak langsung reveal transfer details (perlu mapping off-chain)
- ⚠️ Receiver perlu tahu signature hash untuk withdraw (atau scan semua)
- ⚠️ ERC20 Transfer events masih terlihat (bagian dari standar ERC20)

---

## 🔍 Cara Tracking Transfer

Karena event logs hanya emit signature hash, tracking transfer memerlukan:

1. **Off-chain mapping**: Map signature hash ke transferId
2. **Event scanning**: Scan semua SignatureVerified events
3. **Signature hash lookup**: Gunakan signature hash untuk lookup transfer details

### Example:

```typescript
// Get signature hash from event
const signatureHash = event.args.signatureHash;

// Lookup transfer details (off-chain atau dari contract state)
const transferId = await ingress.getTransferIdFromSignature(signatureHash);
const deposit = await ingress.deposits(transferId);
```

---

## 🚀 Next Steps

1. **Update Scripts**:
   - Update `requestTransfer.ts` untuk handle signature hash
   - Update `checkTransfer.ts` untuk check signature verification
   - Update `withdraw.ts` untuk use signature hash

2. **Add Helper Functions** (Optional):
   - `getTransferIdFromSignature(bytes32 signatureHash)`
   - `getSignatureHashFromTransferId(bytes32 transferId)`

3. **Update Documentation**:
   - Explain signature verification pattern
   - Update flow diagrams

---

## 📝 Summary

**Pattern Baru:**
- ✅ Mantle: Hanya signature hash + timestamp (signature verification records)
- ✅ Oasis: Computation di confidential environment
- ✅ Minimal on-chain footprint
- ✅ Privacy maksimal
- ✅ Mirip dengan Umbra's approach

**Ini membuat transfer terlihat seperti signature verification record, bukan transfer!** 🎯

