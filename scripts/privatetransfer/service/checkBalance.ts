import { ethers } from "hardhat";

async function main() {
  const ingressAddress = process.env.INGRESS_ADDRESS as string;
  const transferId = process.env.TRANSFER_ID as string;

  if (!ingressAddress) {
    throw new Error("Set INGRESS_ADDRESS env var");
  }

  const contract = await ethers.getContractAt(
    "PrivateTransferIngress",
    ingressAddress
  );

  // Check contract balance
  const balance = await ethers.provider.getBalance(ingressAddress);
  console.log(`\n=== Contract Balance ===`);
  console.log(`Ingress contract balance: ${ethers.formatEther(balance)} MNT`);

  // Check deposit info if transferId provided
  if (transferId) {
    console.log(`\n=== Deposit Info ===`);
    const deposit = await contract.deposits(transferId);
    console.log(`Transfer ID: ${transferId}`);
    console.log(`Depositor: ${deposit.depositor}`);
    console.log(`Token: ${deposit.token}`);
    console.log(`Amount: ${ethers.formatEther(deposit.amount)} MNT`);
    console.log(`Is Native: ${deposit.isNative}`);
    console.log(`Released: ${deposit.released}`);

    // Check transfer metadata
    const transfer = await contract.transfers(transferId);
    console.log(`\n=== Transfer Metadata ===`);
    console.log(`Sender: ${transfer.sender}`);
    console.log(`Destination Domain: ${transfer.destinationDomain}`);
    console.log(`Dispatched At: ${new Date(Number(transfer.dispatchedAt) * 1000).toISOString()}`);
    console.log(`Acknowledged: ${transfer.acknowledged}`);
  } else {
    console.log(`\nNote: Set TRANSFER_ID env var to check specific deposit info`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

