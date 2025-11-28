import { ethers } from "hardhat";

async function main() {
  const ingressAddress = process.env.INGRESS_ADDRESS as string;
  const vaultAddress = process.env.VAULT_ADDRESS as string;
  const mantleDomain = Number(process.env.MANTLE_DOMAIN ?? "5003");

  if (!ingressAddress || !vaultAddress) {
    throw new Error(
      "Set INGRESS_ADDRESS and VAULT_ADDRESS env vars before running this script."
    );
  }

  const signer = await ethers.provider.getSigner();
  const vault = await ethers.getContractAt(
    "PrivateTransferVault",
    vaultAddress,
    signer
  );

  const tx = await vault.enrollRemoteRouter(
    mantleDomain,
    ethers.zeroPadValue(ingressAddress, 32)
  );
  await tx.wait();

  console.log(
    `Vault now routes mantle domain ${mantleDomain} to ${ingressAddress}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

