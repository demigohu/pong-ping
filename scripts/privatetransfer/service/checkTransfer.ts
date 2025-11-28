import { ethers } from "hardhat";

async function main() {
  const vaultAddress = process.env.VAULT_ADDRESS as string;
  const transferId = process.env.TRANSFER_ID as string;

  if (!vaultAddress || !transferId) {
    throw new Error("Set VAULT_ADDRESS and TRANSFER_ID env vars.");
  }

  const contract = await ethers.getContractAt(
    "PrivateTransferVault",
    vaultAddress
  );

  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();

  console.log(`\n=== Transfer Status Check ===`);
  console.log(`Vault: ${vaultAddress}`);
  console.log(`Transfer ID: ${transferId}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Vault Owner: ${owner}`);
  console.log(`Is Signer Owner: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  try {
    const transfer = await contract.encryptedTransfers(transferId);
    const hasTransfer = transfer.envelope.ciphertext.length > 0;
    const isAcknowledged = transfer.acknowledged;

    console.log(`\nTransfer exists: ${hasTransfer}`);
    if (hasTransfer) {
      console.log(`Origin Domain: ${transfer.originDomain}`);
      console.log(`Origin Router: ${transfer.originRouter}`);
      console.log(`Ciphertext length: ${transfer.envelope.ciphertext.length} bytes`);
      console.log(`Already processed: ${isAcknowledged}`);
    } else {
      console.log(`\n❌ Transfer not found in Vault!`);
      console.log(`Possible reasons:`);
      console.log(`1. Relayer hasn't relayed the message from Mantle yet`);
      console.log(`2. TRANSFER_ID is incorrect`);
      console.log(`3. Message failed during relay`);
      return;
    }

    if (isAcknowledged) {
      console.log(`\n⚠️  Transfer already processed!`);
      try {
        const payload = await contract.processedPayloads(transferId);
        console.log(`Processed payload:`);
        console.log(`  Receiver: ${payload.receiver}`);
        console.log(`  Token: ${payload.token}`);
        console.log(`  Amount: ${payload.amount}`);
        console.log(`  Is Native: ${payload.isNative}`);
      } catch (e) {
        console.log(`Could not read processed payload`);
      }
      return;
    }

    if (signerAddress.toLowerCase() !== owner.toLowerCase()) {
      console.log(`\n❌ Signer is not the owner!`);
      console.log(`You need to use the PRIVATE_KEY that deployed the Vault.`);
      return;
    }

    console.log(`\n✅ Transfer is ready to process!`);
    console.log(`You can now run ackTransfer.ts`);
  } catch (error: any) {
    console.log(`\n❌ Error checking transfer: ${error.message}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

