import { ethers } from "hardhat";

async function main() {
  // deployed mailbox on Sapphire Testnet
  const mailbox = "0x79d3ECb26619B968A68CE9337DfE016aeA471435";

  const PongFactory = await ethers.getContractFactory("Pong");
  const pong = await PongFactory.deploy(mailbox);
  const pongAddr = await pong.waitForDeployment();
  console.log(`Pong deployed at: ${pongAddr.target}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});