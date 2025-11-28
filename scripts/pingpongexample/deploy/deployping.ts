import { ethers } from "hardhat";

async function main() {
  // default mailbox on Mantle Sepolia
  const mailbox = "0xE495652b291B836334465680156Ce50a100aF52f";

  const PingFactory = await ethers.getContractFactory("Ping");    
  const ping = await PingFactory.deploy(mailbox);
  const pingAddr = await ping.waitForDeployment();
  console.log(`Ping deployed at: ${pingAddr.target}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});