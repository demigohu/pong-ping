import { ethers } from "hardhat";

async function main() {
  const mailbox =
    process.env.SAPPHIRE_MAILBOX ?? process.env.MAILBOX ?? process.env.MANTLE_MAILBOX;

  if (!mailbox) {
    throw new Error("Set SAPPHIRE_MAILBOX (atau MAILBOX) env var untuk deploy LendingCore");
  }

  const factory = await ethers.getContractFactory("LendingCore");
  const core = await factory.deploy(mailbox);
  await core.waitForDeployment();

  console.log(`LendingCore (Sapphire) deployed at ${core.target}`);
  const pubKey = await core.vaultPublicKey();
  console.log(`LendingCore public key: ${pubKey}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


