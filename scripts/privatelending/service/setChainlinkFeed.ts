import { ethers } from "hardhat";

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const token = process.env.TOKEN_ADDRESS as string || ethers.ZeroAddress; // Default to native
  const feedAddress = process.env.CHAINLINK_FEED_ADDRESS as string;

  if (!coreAddress || !feedAddress) {
    throw new Error("Set CORE_ADDRESS and CHAINLINK_FEED_ADDRESS env vars.");
  }

  const contract = await ethers.getContractAt("LendingCore", coreAddress);
  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();

  console.log(`\n=== Set Chainlink Feed ===`);
  console.log(`LendingCore: ${coreAddress}`);
  console.log(`Token: ${token}`);
  console.log(`Feed Address: ${feedAddress}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Is Signer Owner: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  if (signerAddress.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Only owner can set Chainlink feed");
  }

  try {
    console.log(`\nSetting Chainlink feed...`);
    const tx = await contract.setChainlinkFeed(token, feedAddress);
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Chainlink feed set`);
    
    // Verify
    const feed = await contract.chainlinkFeeds(token);
    console.log(`\nVerified feed: ${feed}`);
  } catch (error: any) {
    console.error(`❌ Failed to set feed: ${error.message}`);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});



