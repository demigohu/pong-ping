# Privacy: Position Events

Dokumen ini menjelaskan bagaimana position events dibuat private dengan hanya memancarkan hash, bukan jumlah aktual.

---

## 🔒 Perubahan untuk Privacy

### Sebelum (Public):
```solidity
event PositionUpdated(
    address indexed user,
    address indexed token,
    uint256 collateral,  // ❌ Terlihat di explorer
    uint256 borrow       // ❌ Terlihat di explorer
);
```

### Sesudah (Private):
```solidity
event PositionUpdated(
    address indexed user,
    address indexed token,
    bytes32 indexed positionHash  // ✅ Hanya hash yang terlihat
);
```

**Hash dihitung sebagai**: `keccak256(abi.encodePacked(collateral, borrow))`

---

## ✅ Yang Terlihat di Explorer

**Sekarang**:
- ✅ User address (indexed)
- ✅ Token address (indexed)
- ✅ Position hash (indexed) - **tidak bisa di-reverse ke amounts**
- ❌ Collateral amount - **PRIVATE**
- ❌ Borrow amount - **PRIVATE**

**Sebelum**:
- ✅ User address
- ✅ Token address
- ✅ Collateral amount - **TERLIHAT**
- ✅ Borrow amount - **TERLIHAT**

---

## 🔍 Verifikasi Position Hash

User bisa verify bahwa position hash di event sesuai dengan position mereka:

### Via Contract (Recommended)

```bash
npx hardhat console --network sapphireTestnet
> const core = await ethers.getContractAt("LendingCore", "0x...")
> const hash = await core.computePositionHash("0xUSER_ADDRESS", "0xTOKEN_ADDRESS")
> console.log("Position Hash:", hash)
```

### Via Script

```javascript
const { ethers } = require("ethers");

// Get position from contract
const pos = await core.positions(userAddress, tokenAddress);

// Compute hash
const positionHash = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256"],
    [pos.collateral, pos.borrow]
  )
);

// Compare with event
console.log("Computed hash:", positionHash);
console.log("Event hash:", eventPositionHash);
console.log("Match:", positionHash === eventPositionHash);
```

---

## 📊 Trade-offs

### ✅ Keuntungan:
1. **Privacy**: Collateral dan borrow amounts tidak terlihat di explorer
2. **Auditability**: Masih bisa verify dengan hash
3. **User Control**: User bisa verify sendiri dengan `computePositionHash()`

### ⚠️ Trade-offs:
1. **Frontend**: Frontend tidak bisa langsung baca amounts dari event
   - **Solusi**: Query contract via `positions(user, token)` untuk amounts aktual
2. **Indexers**: Indexers perlu query contract untuk amounts
   - **Solusi**: Indexers bisa query `positions` mapping untuk amounts

---

## 🔐 Privacy Level

### Level 1: Mantle (Public Chain)
- ✅ **Payload terenkripsi**: Hanya ciphertext/hash yang terlihat
- ✅ **Amount hidden**: Tidak terlihat di `submitAction` call data
- ✅ **Deposit terpisah**: Amount di deposit event, bukan di action event

### Level 2: Sapphire (Confidential Chain)
- ✅ **Decrypt private**: Payload hanya di-decrypt di dalam `processAction()`
- ✅ **Position hash**: Event hanya emit hash, bukan amounts
- ✅ **State private**: `positions[user][token]` hanya bisa diakses via view functions

### Level 3: User Verification
- ✅ **User bisa verify**: Dengan `computePositionHash()` untuk match event hash
- ✅ **User bisa query**: Position mereka sendiri via `positions(user, token)`

---

## 📝 Contoh Event di Explorer

**Sebelum** (Public):
```
PositionUpdated(
    user: 0x0170aEadb4DAd9E3D873280b8D39c8eFAc34Ef6B
    token: 0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080
    collateral: 5,000,000  ❌ TERLIHAT
    borrow: 3,000,000      ❌ TERLIHAT
)
```

**Sesudah** (Private):
```
PositionUpdated(
    user: 0x0170aEadb4DAd9E3D873280b8D39c8eFAc34Ef6B
    token: 0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080
    positionHash: 0xabc123...  ✅ Hanya hash, tidak bisa di-reverse
)
```

---

## 🛠️ Untuk Frontend/Indexers

Jika frontend atau indexer perlu amounts aktual:

```javascript
// ❌ Jangan baca dari event (hanya hash)
const event = await contract.queryFilter("PositionUpdated", ...);
// event.args.positionHash - hanya hash

// ✅ Baca dari contract state
const position = await contract.positions(userAddress, tokenAddress);
// position.collateral - amounts aktual
// position.borrow - amounts aktual
```

**Catatan**: 
- User bisa query position mereka sendiri
- Frontend bisa query untuk user yang sudah connect wallet
- Indexers bisa query semua positions (tapi perlu iterate semua users)

---

## ✅ Kesimpulan

Dengan perubahan ini:
- ✅ **Position amounts PRIVATE** di explorer
- ✅ **Masih bisa verify** dengan hash
- ✅ **User bisa query** position mereka sendiri
- ✅ **Frontend tetap bisa** query amounts via contract

**Privacy level**: Position amounts sekarang **fully private** di explorer, hanya user yang bisa lihat amounts mereka sendiri via contract query.

