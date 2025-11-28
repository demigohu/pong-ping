import { ethers } from "hardhat";

async function main() {
  const mailbox =
    process.env.SAPPHIRE_MAILBOX ??
    "0x79d3ECb26619B968A68CE9337DfE016aeA471435";

  const factory = await ethers.getContractFactory("PrivateTransferVault");
  const contract = await factory.deploy(mailbox);
  const instance = await contract.waitForDeployment();

  console.log(`PrivateTransferVault deployed at ${instance.target}`);
  const vault = await ethers.getContractAt(
    "PrivateTransferVault",
    instance.target as string
  );
  const pk = await vault.vaultPublicKey();
  console.log(`Vault public key: ${pk}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

