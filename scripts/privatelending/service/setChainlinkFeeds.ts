import { ethers } from "hardhat";

/**
 * Helper script to set Chainlink feeds for common tokens on Mantle Sepolia.
 * 
 * Chainlink Price Feeds on Mantle Sepolia:
 * - MNT/USD: 0x4c8962833Db7206fd45671e9DC806e4FcC0dCB78
 * - USDC/USD: 0x1d6F6dbD68BD438950c37b1D514e49306F65291E
 * - USDT/USD: 0x71c184d899c1774d597d8D80526FB02dF708A69a
 */

const MANTLE_SEPOLIA_FEEDS: Record<string, { token: string; feed: string; name: string }> = {
  MNT: {
    token: ethers.ZeroAddress, // Native token
    feed: "0x4c8962833Db7206fd45671e9DC806e4FcC0dCB78",
    name: "MNT/USD",
  },
  USDC: {
    token: process.env.USDC_ADDRESS || "0x09Bc4E0D864854c6aFB6eB9A9cdF58aC190D0dF9", // Default Mantle Sepolia USDC
    feed: "0x1d6F6dbD68BD438950c37b1D514e49306F65291E",
    name: "USDC/USD",
  },
  USDT: {
    token: process.env.USDT_ADDRESS || "0x201EBa5CC46D216Ce6DC03F6a759e8E766e956aE", // Default Mantle Sepolia USDT
    feed: "0x71c184d899c1774d597d8D80526FB02dF708A69a",
    name: "USDT/USD",
  },
};

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const tokensToSet = process.env.TOKENS?.split(",").map((t) => t.trim().toUpperCase()) || Object.keys(MANTLE_SEPOLIA_FEEDS);

  if (!coreAddress) {
    throw new Error("Set CORE_ADDRESS env var.");
  }

  const contract = await ethers.getContractAt("LendingCore", coreAddress);
  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();

  console.log(`\n=== Set Chainlink Feeds ===`);
  console.log(`LendingCore: ${coreAddress}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Network: ${(await ethers.provider.getNetwork()).name}`);
  console.log(`Tokens to set: ${tokensToSet.join(", ")}`);

  if (signerAddress.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Only owner can set Chainlink feeds");
  }

  for (const tokenKey of tokensToSet) {
    const config = MANTLE_SEPOLIA_FEEDS[tokenKey];
    if (!config) {
      console.log(`⚠️  Skipping unknown token: ${tokenKey}`);
      continue;
    }

    console.log(`\n--- Setting ${config.name} ---`);
    console.log(`Token: ${config.token}`);
    console.log(`Feed: ${config.feed}`);

    try {
      // Check if already set
      const existingFeed = await contract.chainlinkFeeds(config.token);
      if (existingFeed.toLowerCase() === config.feed.toLowerCase()) {
        console.log(`✅ Feed already set correctly`);
        continue;
      }

      if (existingFeed !== ethers.ZeroAddress) {
        console.log(`⚠️  Feed already set to different address: ${existingFeed}`);
        console.log(`   Updating to new feed...`);
      }

      const tx = await contract.setChainlinkFeed(config.token, config.feed);
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Feed set for ${config.name}`);

      // Verify
      const feed = await contract.chainlinkFeeds(config.token);
      console.log(`   Verified feed: ${feed}`);
    } catch (error: any) {
      console.error(`❌ Failed to set feed for ${config.name}: ${error.message}`);
      if (error.reason) {
        console.error(`   Reason: ${error.reason}`);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  for (const tokenKey of tokensToSet) {
    const config = MANTLE_SEPOLIA_FEEDS[tokenKey];
    if (!config) continue;

    try {
      const feed = await contract.chainlinkFeeds(config.token);
      console.log(`${config.name}: ${feed === ethers.ZeroAddress ? "❌ Not set" : `✅ ${feed}`}`);
    } catch (e) {
      console.log(`${config.name}: ❌ Error checking`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

