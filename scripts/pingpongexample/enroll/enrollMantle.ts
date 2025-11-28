import { ethers } from "hardhat";

async function main() {
  const mantlePing = "0x4C2c941D37d1C2D1CB2b23A76a0df5233c971009";
  const sapphirePong = "0xb4afC0857096a32382F2a3b4c534370eb0F0A1E8";
  const sapphireDomain = "23295";

  const signer = await ethers.provider.getSigner();
  const contract = await ethers.getContractAt("Ping", mantlePing, signer);
  await contract.enrollRemoteRouter(
    sapphireDomain,
    ethers.zeroPadValue(sapphirePong, 32)
  );
  const remote = await contract.routers(sapphireDomain);
  console.log(`remote router adr for ${sapphireDomain}: ${remote}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});