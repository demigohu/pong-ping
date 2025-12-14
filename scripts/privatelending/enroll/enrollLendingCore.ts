import { ethers } from "hardhat";

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const ingressAddress = process.env.INGRESS_ADDRESS as string;
  const mantleDomain = Number(process.env.MANTLE_DOMAIN ?? "5003");

  if (!coreAddress || !ingressAddress) {
    throw new Error("Set CORE_ADDRESS dan INGRESS_ADDRESS env vars");
  }

  const signer = await ethers.provider.getSigner();
  const core = await ethers.getContractAt("LendingCore", coreAddress, signer);

  const tx = await core.enrollRemoteRouter(
    mantleDomain,
    ethers.zeroPadValue(ingressAddress, 32)
  );
  await tx.wait();

  console.log(
    `LendingCore now routes mantle domain ${mantleDomain} to ${ingressAddress}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


