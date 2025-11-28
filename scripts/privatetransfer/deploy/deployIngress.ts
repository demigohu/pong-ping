import { ethers } from "hardhat";

async function main() {
  const mailbox =
    process.env.MANTLE_MAILBOX ??
    "0x598facE78a4302f11E3de0bee1894Da0b2Cb71F8";

  const factory = await ethers.getContractFactory(
    "PrivateTransferIngress"
  );
  const contract = await factory.deploy(mailbox);
  const instance = await contract.waitForDeployment();

  console.log(`PrivateTransferIngress deployed at ${instance.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

