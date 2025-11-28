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

  console.log(`\n=== Pre-flight Checks ===`);
  console.log(`Vault: ${vaultAddress}`);
  console.log(`Transfer ID: ${transferId}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Is Signer Owner: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  // Check transfer exists
  const transfer = await contract.encryptedTransfers(transferId);
  console.log(`\nTransfer exists: ${transfer.envelope.ciphertext.length > 0}`);
  console.log(`Already acknowledged: ${transfer.acknowledged}`);

  if (transfer.acknowledged) {
    throw new Error("Transfer already processed!");
  }

  // Estimate gas first
  const gasFee = ethers.parseEther(process.env.ACK_GAS_FEE ?? "0");
  if (gasFee !== 0n) {
    throw new Error(
      "ACK_GAS_FEE must be 0 while Vault dispatches without IGP. Remove the env or set it to 0."
    );
  }
  console.log(`\nGas fee: ${ethers.formatEther(gasFee)} tokens`);
  
  try {
    console.log(`\nEstimating gas...`);
    const gasEstimate = await contract.processTransfer.estimateGas(transferId, {
      value: gasFee,
    });
    console.log(`✅ Gas estimate: ${gasEstimate.toString()}`);
  } catch (estimateError: any) {
    console.log(`❌ Gas estimation failed: ${estimateError.message}`);
    if (estimateError.reason) {
      console.log(`Reason: ${estimateError.reason}`);
    }
    if (estimateError.data) {
      console.log(`Error data: ${estimateError.data}`);
    }
    throw estimateError;
  }

  console.log(`\nSending transaction...`);
  const tx = await contract.processTransfer(transferId as `0x${string}`, {
    value: gasFee,
  });
  console.log(`Transaction hash: ${tx.hash}`);
  console.log(`Waiting for confirmation...`);
  
  const receipt = await tx.wait();
  if (receipt?.status === 1) {
    console.log(`✅ Release instruction dispatched in tx ${receipt?.hash}`);
  } else {
    throw new Error(`Transaction failed with status ${receipt?.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

