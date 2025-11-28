import { ethers } from "hardhat";

async function main() {
  const ingressAddress = process.env.INGRESS_ADDRESS as string;
  const vaultAddress = process.env.VAULT_ADDRESS as string;
  const sapphireDomain = Number(process.env.SAPPHIRE_DOMAIN ?? "23295");

  if (!ingressAddress || !vaultAddress) {
    throw new Error(
      "Set INGRESS_ADDRESS and VAULT_ADDRESS env vars before running this script."
    );
  }

  const signer = await ethers.provider.getSigner();
  const ingress = await ethers.getContractAt(
    "PrivateTransferIngress",
    ingressAddress,
    signer
  );

  const tx = await ingress.enrollRemoteRouter(
    sapphireDomain,
    ethers.zeroPadValue(vaultAddress, 32)
  );
  await tx.wait();

  console.log(
    `Ingress now routes sapphire domain ${sapphireDomain} to ${vaultAddress}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

