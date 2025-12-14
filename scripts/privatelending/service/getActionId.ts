import { ethers } from "hardhat";

async function main() {
  const ingressAddress = process.env.INGRESS_ADDRESS as string;
  const txHash = process.env.TX_HASH as string;

  if (!ingressAddress || !txHash) {
    throw new Error("Set INGRESS_ADDRESS and TX_HASH env vars.");
  }

  const contract = await ethers.getContractAt(
    "PrivateLendingIngress",
    ingressAddress
  );

  console.log(`\n=== Get Action ID from Transaction ===`);
  console.log(`Ingress: ${ingressAddress}`);
  console.log(`Transaction Hash: ${txHash}`);

  const receipt = await ethers.provider.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Transaction not found: ${txHash}`);
  }

  const logs = receipt.logs ?? [];
  const ev = logs.find((log: any) => {
    try {
      const parsed = contract.interface.parseLog(log);
      return parsed?.name === "EncryptedActionReceived";
    } catch {
      return false;
    }
  });

  if (!ev) {
    throw new Error("EncryptedActionReceived event not found in transaction");
  }

  const parsed = contract.interface.parseLog(ev as any);
  if (!parsed) {
    throw new Error("Failed to parse EncryptedActionReceived log");
  }

  const encryptedDataHash = parsed.args.encryptedDataHash;
  const actionId = await contract.ciphertextHashToActionId(encryptedDataHash);

  console.log(`\n✅ Action ID: ${actionId}`);
  console.log(`\nTo process this action on Sapphire, run:`);
  console.log(`CORE_ADDRESS=0x... ACTION_ID=${actionId} npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

