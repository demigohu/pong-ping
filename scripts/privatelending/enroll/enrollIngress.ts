import { ethers } from "hardhat";

async function main() {
  const ingressAddress = process.env.INGRESS_ADDRESS as string;
  const coreAddress = process.env.CORE_ADDRESS as string;
  const sapphireDomain = Number(process.env.SAPPHIRE_DOMAIN ?? "23295");

  if (!ingressAddress || !coreAddress) {
    throw new Error("Set INGRESS_ADDRESS dan CORE_ADDRESS env vars");
  }

  const signer = await ethers.provider.getSigner();
  const ingress = await ethers.getContractAt(
    "PrivateLendingIngress",
    ingressAddress,
    signer
  );

  const tx = await ingress.enrollRemoteRouter(
    sapphireDomain,
    ethers.zeroPadValue(coreAddress, 32)
  );
  await tx.wait();

  console.log(
    `Ingress now routes sapphire domain ${sapphireDomain} to ${coreAddress}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


