import { ethers } from "hardhat";

async function main() {
  const mailbox =
    process.env.MANTLE_MAILBOX ?? process.env.MAILBOX ?? process.env.SAPPHIRE_MAILBOX;

  if (!mailbox) {
    throw new Error("Set MANTLE_MAILBOX (atau MAILBOX) env var untuk deploy Ingress");
  }

  const factory = await ethers.getContractFactory("PrivateLendingIngress");
  const ingress = await factory.deploy(mailbox);
  await ingress.waitForDeployment();

  console.log(`PrivateLendingIngress deployed at ${ingress.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


