import { ethers } from "hardhat";

async function main() {
  // default mailbox on mantle Sepolia
  const mailbox = "0xE495652b291B836334465680156Ce50a100aF52f";
  const trustedRelayer = "0xe825ad911bb26e9f800128949179cd0caad58e9b";

  const trustedRelayerISM = await ethers.deployContract(
    "TrustedRelayerIsm",
    [mailbox, trustedRelayer]
    );
  await trustedRelayerISM.waitForDeployment();
  console.log(`TrustedRelayerISM deployed to ${trustedRelayerISM.target}`);
}
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });