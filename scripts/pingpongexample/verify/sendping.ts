import { ethers } from "hardhat";

async function main() {
  const destChainId = "23295"; // Sapphire domain
  const message = "Hello OPL";
  const mantlePing = "0x4C2c941D37d1C2D1CB2b23A76a0df5233c971009";

  const signer = await ethers.provider.getSigner();
  const contract = await ethers.getContractAt("Ping", mantlePing, signer);

  console.log("Calculating fee...");
  const fee = await contract.quoteDispatch(
      destChainId,
      ethers.toUtf8Bytes(message));
  console.log(`Fee: ${ethers.formatEther(fee)} ETH`);
  console.log("Sending message...");
  const tx = await contract.sendPing(destChainId, message, {value: fee});
  await tx.wait();
  console.log("Message sent");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});