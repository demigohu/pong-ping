import { ethers } from "hardhat";

async function main() {
  const txHash = process.env.TX_HASH as string;

  if (!txHash) {
    throw new Error("Set TX_HASH env var");
  }

  const provider = ethers.provider;
  const receipt = await provider.getTransactionReceipt(txHash);
  
  if (!receipt) {
    throw new Error("Transaction not found");
  }

  const tx = await provider.getTransaction(txHash);
  
  console.log(`\n=== Transaction Details ===`);
  console.log(`Tx Hash: ${txHash}`);
  console.log(`From: ${tx?.from}`);
  console.log(`To: ${tx?.to}`);
  console.log(`Value sent: ${ethers.formatEther(tx?.value || 0n)} MNT`);
  console.log(`Gas Price: ${ethers.formatUnits(tx?.gasPrice || 0n, "gwei")} gwei`);
  console.log(`Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`Status: ${receipt.status === 1 ? "Success" : "Failed"}`);

  // Try to decode the function call
  try {
    const ingressAddress = process.env.INGRESS_ADDRESS as string;
    if (ingressAddress) {
      const contract = await ethers.getContractAt(
        "PrivateTransferIngress",
        ingressAddress
      );
      
      const decoded = contract.interface.parseTransaction({
        data: tx?.data || "",
        value: tx?.value || 0n,
      });
      
      if (decoded) {
        console.log(`\n=== Function Call ===`);
        console.log(`Function: ${decoded.name}`);
        console.log(`Args:`);
        decoded.args.forEach((arg: any, idx: number) => {
          if (idx === 1) {
            // ciphertext - just show length
            console.log(`  [${idx}]: ciphertext (${ethers.dataLength(arg)} bytes)`);
          } else if (idx === 2) {
            // depositAmount
            console.log(`  [${idx}]: depositAmount = ${ethers.formatEther(arg)} MNT`);
          } else {
            console.log(`  [${idx}]: ${arg}`);
          }
        });
      }
    }
  } catch (e) {
    console.log(`\nCould not decode transaction data`);
  }

  // Check events
  console.log(`\n=== Events ===`);
  receipt.logs.forEach((log, idx) => {
    console.log(`Event ${idx + 1}: ${log.address}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

