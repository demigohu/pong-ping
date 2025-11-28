import { ethers } from "hardhat";

async function main() {
  const mantlePing = "0x4C2c941D37d1C2D1CB2b23A76a0df5233c971009";
  const sapphirePong = "0xb4afC0857096a32382F2a3b4c534370eb0F0A1E8";
  const mantleDomain = "5003";

  const signer = await ethers.provider.getSigner();
  const contract = await ethers.getContractAt("Pong", sapphirePong, signer);
  await contract.enrollRemoteRouter(
    mantleDomain,
    ethers.zeroPadValue(mantlePing, 32)
  );
  const remote = await contract.routers(mantleDomain);
  console.log(`remote router adr for ${mantleDomain}: ${remote}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});