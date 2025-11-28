import { ethers } from "hardhat";

async function main() {
  const mantlePing = "0x4C2c941D37d1C2D1CB2b23A76a0df5233c971009";
  const ismAddr = "0xe3C22AeA1A59d4324Df5aDA220F5Bd67499F78cA";

  const signer = await ethers.provider.getSigner();
  const contract = await ethers.getContractAt("Ping", mantlePing, signer);
  await contract.setInterchainSecurityModule(ismAddr);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});