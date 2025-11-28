# Panduan Ping-Pong Hyperlane Mantle ↔ Sapphire

Ringkasan langkah praktis berdasarkan dokumentasi Oasis OPL Hyperlane Ping Pong Example untuk menguji pesan silang jaringan antara Mantle Sepolia Testnet dan Sapphire Testnet. Sesuaikan domain ID, RPC, dan alamat kontrak sesuai kebutuhanmu.

## 1. Prasyarat
- Proyek Hardhat sudah diinisialisasi di root repo ini (`npx hardhat` ✔️).
- Node.js ≥ 18, `pnpm` atau `npm`.
- PRIVATE_KEY terset di `.env` (alamat deployer punya gas di kedua chain).
- Faucet gas: Mantle Sepolia & Sapphire Testnet.

## 2. Dependensi
```bash
pnpm add -D @hyperlane-xyz/core ethers@^6 openzeppelin-solidity@^4.9.3
```
Pastikan `hardhat.config.ts` sudah impor toolbox bila perlu (`@nomicfoundation/hardhat-toolbox`).

## 3. Konfigurasi Jaringan (`hardhat.config.ts`)
Tambahkan konfigurasi berikut (sesuaikan RPC & akun):
```ts
mantle: {
  url: "https://rpc.sepolia.mantle.xyz",
  chainId: 5003,
  accounts,
},
sapphireTestnet: {
  url: "https://testnet.sapphire.oasis.io",
  chainId: 23295,
  accounts,
},
```
Jika Hardhat mengganti `evmVersion`, set `evmVersion: "paris"` di konfigurasi Solidity agar kompatibel dengan Sapphire/Mantle.

## 4. Kontrak
1. Buat `contracts/Ping.sol` dan `contracts/Pong.sol` dengan isi dari contoh Hyperlane (Router wrapper).
2. Penempatan untuk skenario ini:
   - `Ping.sol` di Mantle Sepolia (pengirim awal).
   - `Pong.sol` di Sapphire Testnet (penerima balik).

## 5. Deploy Trusted Relayer ISM di Mantle
- Tambah skrip `scripts/deployISM.ts` (lihat contoh di dokumentasi).
- Jalankan di Mantle:
  ```bash
  pnpm hardhat run scripts/deployISM.ts --network mantle
  ```
- Catat alamat ISM dan alamat relayer yang dipercaya.

## 6. Deploy Kontrak
- Deploy `Ping.sol` ke Mantle:
  ```bash
  pnpm hardhat run scripts/deployPing.ts --network mantle
  ```
- Deploy `Pong.sol` ke Sapphire:
  ```bash
  pnpm hardhat run scripts/deployPong.ts --network sapphireTestnet
  ```
Pastikan constructor `Ping/Pong` menerima alamat Mailbox Hyperlane untuk jaringan masing-masing.

## 7. Enroll Router
Buat skrip `scripts/enrollMantle.ts` dan `scripts/enrollSapphire.ts` (atau satu skrip dengan argumen):

```ts
// di Mantle (kontrak Ping)
await contract.enrollRemoteRouter(
  SAPPHIRE_DOMAIN_ID,
  ethers.zeroPadValue(pongAddr, 32)
);
```

```ts
// di Sapphire (kontrak Pong)
await contract.enrollRemoteRouter(
  MANTLE_DOMAIN_ID,
  ethers.zeroPadValue(pingAddr, 32)
);
```
Jalankan di jaringan masing-masing sampai `routers(domainId)` terisi benar.

## 8. Set ISM di Kontrak Mantle
Buat `scripts/registerIsm.ts`:
```ts
await ping.setInterchainSecurityModule(ismAddr);
```
Eksekusi di jaringan asal:
```bash
pnpm hardhat run scripts/registerIsm.ts --network mantle
```

## 9. Jalankan Relayer
- Jalankan Hyperlane relayer yang memonitor domain Mantle ↔ Sapphire.
- Pastikan config sesuai trusted relayer ISM dan RPC dapat diakses.

## 10. Kirim Ping dari Mantle
Gunakan skrip `scripts/sendping.ts`:
```ts
const destChainId = SAPPHIRE_DOMAIN_ID;
const fee = await contract.quoteDispatch(destChainId, ethers.toUtf8Bytes(message));
await contract.sendPing(destChainId, message, { value: fee });
```
Jalankan pada jaringan Mantle (`--network mantle`).

## 11. Verifikasi
- Skrip `scripts/verifyping.ts` memantau event `ReceivedPing` pada kontrak tujuan (Sapphire) maupun event balasan di Mantle.
- Alternatif: cek explorer Mantle/Sapphire untuk event `SentPing` & `ReceivedPing`.

## 12. Troubleshooting
- **Pesan tidak sampai**: pastikan `enrollRemoteRouter` benar, ISM sudah diset di Mantle, relayer aktif di kedua domain.
- **Event tidak muncul**: gunakan RPC yang mendukung query histori, perbesar rentang blok, pastikan relayer log tidak error.

Referensi utama: [Oasis OPL Hyperlane Ping Pong Example](https://docs.oasis.io/build/opl/hyperlane/pingpong-example).

---

# Private Transfer (Mantle → Sapphire)

Contoh berikut memperluas pola Router OPL supaya kamu bisa mengirim instruksi transfer terenkripsi dari Mantle Sepolia ke Sapphire Testnet. Payload yang berisi alamat kontrak & jumlah harus sudah dienkripsi di sisi klien; kontrak hanya melihat hash/ciphertext sehingga detailnya tetap privat di jaringan publik.

## Arsitektur & Alur
1. **Client/User** mengenkripsi data `(receiver, amount, memo, nonce)` menggunakan kunci publik yang hanya bisa dibuka di Sapphire.
2. **Ingress (Mantle)** menerima ciphertext via `initiatePrivateTransfer`, mencetak `transferId`, lalu men-dispatch payload `(transferId, ciphertext)` ke domain Sapphire lewat Hyperlane. State di Mantle hanya menyimpan hash, bukan isi plaintext.
3. **Vault (Sapphire)** menerima payload di `_handle`, menyimpan ciphertext ke storage confidential Sapphire. Di sini kamu bisa mendekripsi dan menjalankan logika privat (update saldo, call kontrak lain).
4. Setelah selesai, **Vault** dapat memanggil `acknowledgeTransfer` untuk mengirim pesan balik ke Ingress. Mantle hanya tahu bahwa transfer `transferId` telah diproses; detail tetap tersembunyi.

## Kontrak
- `contracts/privatetransfer/PrivateTransferIngress.sol`  
  Berjalan di Mantle. Mengemas ciphertext dan mengirimnya lewat Hyperlane.
- `contracts/privatetransfer/PrivateTransferVault.sol`  
  Berjalan di Sapphire. Menyimpan ciphertext, menyediakan fungsi dekripsi (`revealTransfer`) berbasis kunci rahasia yang hanya disimpan di Sapphire, dan mengirim ack balik ke ingress setelah diproses.

## Deploy
```
MANTLE_MAILBOX=0x598f... \
npx hardhat run scripts/privatetransfer/deploy/deployIngress.ts --network mantleSepolia

SAPPHIRE_MAILBOX=0x79d3... \
npx hardhat run scripts/privatetransfer/deploy/deployVault.ts --network sapphireTestnet
```

## Enroll Router
```
INGRESS_ADDRESS=<mantle ingress>
VAULT_ADDRESS=<sapphire vault>
SAPPHIRE_DOMAIN=23295 \
npx hardhat run scripts/privatetransfer/enroll/enrollIngress.ts --network mantleSepolia

MANTLE_DOMAIN=5003 \
npx hardhat run scripts/privatetransfer/enroll/enrollVault.ts --network sapphireTestnet
```

## Kirim Instruksi Privat
1. Ambil public key Vault (sekali) dengan `getVaultPublicKey.ts`, simpan sebagai `VAULT_PUBLIC_KEY`.
2. Jalankan `requestTransfer.ts` untuk **mengunci dana + mengenkripsi payload**. Pilih `TOKEN_TYPE=native` (MNT) atau `TOKEN_TYPE=erc20` (mis. USDC Mantle `0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080`). Contoh:
```
INGRESS_ADDRESS=<ingress>
VAULT_PUBLIC_KEY=0x...
RECEIVER=0x...
AMOUNT=10
TOKEN_TYPE=erc20
TOKEN_ADDRESS=0xAcab8129E2cE587fD203FD770ec9ECAFA2C88080
TOKEN_DECIMALS=6
DISPATCH_GAS_FEE=0.0005
npx hardhat run scripts/privatetransfer/service/requestTransfer.ts --network mantleSepolia
```
Skrip otomatis melakukan `approve` (untuk ERC20), mengunci dana pada Ingress, dan mengirim payload terenkripsi. Detail lengkap ada di `PRIVATE_TRANSFER.md`.

## Ack di Sapphire
Setelah pesan tiba di Sapphire, jalankan:
```
VAULT_ADDRESS=<vault> \
TRANSFER_ID=0x<id dari event EncryptedTransferStored> \
ACK_GAS_FEE=0.0005 \
npx hardhat run scripts/privatetransfer/service/ackTransfer.ts --network sapphireTestnet
```
Skrip tersebut memanggil `processTransfer`, mendekripsi payload, lalu mengirim instruksi rilis ke Mantle.

Apabila kamu butuh otomatisasi penuh, jalankan relayer Hyperlane seperti biasa dan tambah daemon yang memanggil `ackTransfer` setiap kali event baru muncul.

## Catatan Privasi
- Klien mengenkripsi payload menggunakan public key Vault berbasis X25519; hanya Sapphire yang memiliki secret key untuk mendekripsi.
- Kontrak Vault memakai precompile `Sapphire.decrypt` dan otomatis meneruskan instruksi rilis. Tidak ada kunci statis di storage.
- Jangan lupa isi Vault dengan gas native untuk biaya `processTransfer` dan jalankan relayer Hyperlane agar pesan bolak-balik.

