import { ethers } from "hardhat";

async function main() {
  const vaultAddress = process.env.VAULT_ADDRESS as string;
  if (!vaultAddress) {
    throw new Error("Set VAULT_ADDRESS env var");
  }

  const vault = await ethers.getContractAt(
    "PrivateTransferVault",
    vaultAddress
  );
  const pk = await vault.vaultPublicKey();
  console.log(`Vault public key: ${pk}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

