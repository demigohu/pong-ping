import { ethers } from "hardhat";

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const token = process.env.TOKEN_ADDRESS as string || ethers.ZeroAddress; // Default to native
  const useRoflOracle = process.env.USE_ROFL_ORACLE === "true";
  const manualPrice = process.env.MANUAL_PRICE; // Optional: manual price override

  if (!coreAddress) {
    throw new Error("Set CORE_ADDRESS env var.");
  }

  const contract = await ethers.getContractAt("LendingCore", coreAddress);
  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();

  console.log(`\n=== Price Update ===`);
  console.log(`LendingCore: ${coreAddress}`);
  console.log(`Token: ${token}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Is Signer Owner: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  if (useRoflOracle) {
    const oracle = await contract.roflOracles(token);
    if (oracle === ethers.ZeroAddress) {
      throw new Error(`ROFL Oracle not set for token ${token}. Set it first with setRoflOracle, or use updatePriceFromRoflOracle.ts script.`);
    }
    console.log(`\nUsing ROFL Oracle: ${oracle}`);
    
    try {
      console.log(`Fetching price from ROFL Oracle...`);
      const tx = await contract.updatePriceFromRoflOracle(token);
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Price updated from ROFL Oracle`);
    } catch (error: any) {
      console.error(`❌ Failed to update from ROFL Oracle: ${error.message}`);
      throw error;
    }
  } else if (manualPrice) {
    const price = ethers.parseUnits(manualPrice, 8); // Chainlink uses 8 decimals
    console.log(`\nUpdating price manually: ${ethers.formatUnits(price, 8)} USD`);
    
    try {
      const tx = await contract.updatePrice(token, price);
      console.log(`Transaction hash: ${tx.hash}`);
      await tx.wait();
      console.log(`✅ Price updated manually`);
    } catch (error: any) {
      console.error(`❌ Failed to update price: ${error.message}`);
      throw error;
    }
  } else {
    throw new Error("Set USE_ROFL_ORACLE=true or MANUAL_PRICE=<price>");
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



