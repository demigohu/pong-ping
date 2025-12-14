import { ethers } from "hardhat";

async function main() {
  const mailbox =
    process.env.MAILBOX ?? process.env.MANTLE_MAILBOX ?? process.env.SAPPHIRE_MAILBOX;
  const trustedRelayer =
    process.env.TRUSTED_RELAYER ?? process.env.RELAYER_ADDRESS;

  if (!mailbox) {
    throw new Error(
      "Set MAILBOX (atau MANTLE_MAILBOX/SAPPHIRE_MAILBOX) env var untuk deploy ISM"
    );
  }
  if (!trustedRelayer) {
    throw new Error("Set TRUSTED_RELAYER env var (alamat relayer terpercaya)");
  }

  const factory = await ethers.getContractFactory(
    "contracts/privatetransfer/TrustedRelayerIsm.sol:TrustedRelayerIsm"
  );
  const ism = await factory.deploy(mailbox, trustedRelayer);
  await ism.waitForDeployment();
  console.log(`PrivateLending TrustedRelayerISM deployed at ${ism.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


