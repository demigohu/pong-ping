import { ethers } from "hardhat";

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const token = process.env.TOKEN_ADDRESS as string || ethers.ZeroAddress; // Default to native

  if (!coreAddress) {
    throw new Error("Set CORE_ADDRESS env var.");
  }

  const contract = await ethers.getContractAt("LendingCore", coreAddress);
  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();

  console.log(`\n=== Update Price from ROFL Oracle ===`);
  console.log(`LendingCore: ${coreAddress}`);
  console.log(`Token: ${token}`);
  console.log(`Signer: ${signerAddress}`);

  // Check if ROFL Oracle is set
  const roflOracle = await contract.roflOracles(token);
  if (roflOracle === ethers.ZeroAddress) {
    throw new Error(`ROFL Oracle not set for token ${token}. Set it first with setRoflOracle.`);
  }
  console.log(`ROFL Oracle: ${roflOracle}`);

  // Query ROFL Oracle directly to show current observation
  try {
    const roflOracleContract = await ethers.getContractAt(
      ["function getLastObservation() external view returns (uint128 value, uint block)"],
      roflOracle
    );
    const [value, blockNum] = await roflOracleContract.getLastObservation();
    console.log(`\n=== ROFL Oracle Observation ===`);
    console.log(`Value: ${value.toString()}`);
    console.log(`Block: ${blockNum.toString()}`);
    console.log(`Current Block: ${await ethers.provider.getBlockNumber()}`);
    
    // Check if observation is fresh (within 10 blocks as per ROFL Oracle pattern)
    const currentBlock = await ethers.provider.getBlockNumber();
    if (currentBlock > blockNum + 10) {
      console.warn(`⚠️  Warning: Observation is stale (${currentBlock - blockNum} blocks old)`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not query ROFL Oracle directly: ${error.message}`);
  }

  try {
    console.log(`\nUpdating price from ROFL Oracle...`);
    const tx = await contract.updatePriceFromRoflOracle(token);
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ Price updated from ROFL Oracle`);
  } catch (error: any) {
    console.error(`❌ Failed to update from ROFL Oracle: ${error.message}`);
    throw error;
  }

  // Show updated price
  const priceData = await contract.prices(token);
  console.log(`\n=== Updated Price ===`);
  console.log(`Price: ${ethers.formatUnits(priceData.price, 8)} USD`);
  console.log(`Timestamp: ${new Date(Number(priceData.timestamp) * 1000).toISOString()}`);
  console.log(`Valid: ${priceData.valid}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

