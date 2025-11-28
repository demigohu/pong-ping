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

  console.log(`\n=== Debugging processTransfer ===`);
  console.log(`Vault: ${vaultAddress}`);
  console.log(`Transfer ID: ${transferId}`);

  // Check transfer exists
  try {
    const transfer = await contract.encryptedTransfers(transferId);
    console.log(`\nTransfer exists: ${transfer.envelope.ciphertext.length > 0}`);
    console.log(`Ciphertext length: ${transfer.envelope.ciphertext.length} bytes`);
    console.log(`Already acknowledged: ${transfer.acknowledged}`);
    console.log(`Origin Domain: ${transfer.originDomain}`);
  } catch (e: any) {
    console.log(`Error reading transfer: ${e.message}`);
    return;
  }

  // Check if signer is owner
  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();
  console.log(`\nSigner: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Is Signer Owner: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  // Try to call revealTransfer (view function) to see if decryption works
  if (signerAddress.toLowerCase() === owner.toLowerCase()) {
    console.log(`\n=== Testing Decryption (revealTransfer) ===`);
    try {
      const plaintext = await contract.revealTransfer(transferId);
      console.log(`✅ Decryption successful!`);
      console.log(`Plaintext length: ${plaintext.length} bytes`);
      
      // Try to decode the payload
      try {
        const payload = ethers.AbiCoder.defaultAbiCoder().decode(
          ["tuple(address receiver,address token,uint256 amount,bool isNative,bytes memo)"],
          plaintext
        )[0];
        console.log(`\n✅ Payload decoded successfully:`);
        console.log(`  Receiver: ${payload.receiver}`);
        console.log(`  Token: ${payload.token}`);
        console.log(`  Amount: ${ethers.formatEther(payload.amount)} MNT`);
        console.log(`  Is Native: ${payload.isNative}`);
        console.log(`  Memo length: ${payload.memo.length} bytes`);
      } catch (decodeError: any) {
        console.log(`❌ Failed to decode payload: ${decodeError.message}`);
        console.log(`Plaintext hex (first 100 bytes): ${ethers.hexlify(plaintext.slice(0, 100))}`);
      }
    } catch (e: any) {
      console.log(`❌ Decryption failed: ${e.message}`);
      if (e.reason) {
        console.log(`Reason: ${e.reason}`);
      }
    }
  } else {
    console.log(`\n⚠️  Skipping revealTransfer test - signer is not owner`);
  }

  // Try static call to processTransfer to see if it would succeed
  console.log(`\n=== Testing processTransfer (static call) ===`);
  try {
    const signer = await ethers.provider.getSigner();
    const gasFee = ethers.parseEther(process.env.ACK_GAS_FEE ?? "0");
    
    // Use callStatic to simulate the transaction
    await contract.processTransfer.staticCall(transferId, {
      value: gasFee,
    });
    console.log(`✅ Static call successful - transaction should work!`);
  } catch (e: any) {
    console.log(`❌ Static call failed: ${e.message}`);
    if (e.reason) {
      console.log(`Reason: ${e.reason}`);
    }
    if (e.data) {
      console.log(`Error data: ${e.data}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

