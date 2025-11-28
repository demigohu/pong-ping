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

  console.log(`\n=== Testing revealTransfer ===`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Match: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  if (signerAddress.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Signer is not the owner!");
  }

  try {
    console.log(`\nCalling revealTransfer...`);
    const plaintext = await contract.revealTransfer(transferId);
    console.log(`✅ Decryption successful!`);
    console.log(`Plaintext length: ${plaintext.length} bytes`);
    
    // Try to decode
    try {
      const payload = ethers.AbiCoder.defaultAbiCoder().decode(
        ["tuple(address receiver,address token,uint256 amount,bool isNative,bytes memo)"],
        plaintext
      )[0];
      console.log(`\n✅ Payload decoded:`);
      console.log(`  Receiver: ${payload.receiver}`);
      console.log(`  Token: ${payload.token}`);
      console.log(`  Amount: ${ethers.formatEther(payload.amount)} MNT`);
      console.log(`  Is Native: ${payload.isNative}`);
    } catch (e: any) {
      console.log(`❌ Decode failed: ${e.message}`);
      console.log(`Plaintext (hex): ${ethers.hexlify(plaintext)}`);
    }
  } catch (e: any) {
    console.log(`❌ revealTransfer failed: ${e.message}`);
    if (e.reason) {
      console.log(`Reason: ${e.reason}`);
    }
    throw e;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

