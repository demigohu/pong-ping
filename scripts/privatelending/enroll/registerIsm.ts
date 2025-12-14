import { ethers } from "hardhat";

async function main() {
  const routerAddress = process.env.ROUTER_ADDRESS;
  const ismAddress = process.env.ISM_ADDRESS;

  if (!routerAddress) {
    throw new Error("Set ROUTER_ADDRESS env var (Ingress atau LendingCore)");
  }
  if (!ismAddress) {
    throw new Error("Set ISM_ADDRESS env var");
  }

  const signer = await ethers.provider.getSigner();
  const contract = await ethers.getContractAt("Router", routerAddress, signer);
  const tx = await contract.setInterchainSecurityModule(ismAddress);
  await tx.wait();
  console.log(
    `ISM ${ismAddress} registered for router ${routerAddress} (tx: ${tx.hash})`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


