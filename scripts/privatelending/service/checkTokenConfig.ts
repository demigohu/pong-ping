import { ethers } from "hardhat";

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const tokenAddress = process.env.TOKEN_ADDRESS as string || ethers.ZeroAddress;

  if (!coreAddress) {
    throw new Error("Set CORE_ADDRESS env var.");
  }

  const contract = await ethers.getContractAt("LendingCore", coreAddress);

  console.log(`\n=== Token Config Check ===`);
  console.log(`LendingCore: ${coreAddress}`);
  console.log(`Token: ${tokenAddress}`);

  const config = await contract.tokenConfigs(tokenAddress);
  
  console.log(`\n=== Token Configuration ===`);
  console.log(`Enabled: ${config.enabled}`);
  console.log(`LTV: ${config.ltv.toString()} bps (${Number(config.ltv) / 100}%)`);
  console.log(`Liquidation Threshold: ${config.liquidationThreshold.toString()} bps (${Number(config.liquidationThreshold) / 100}%)`);
  console.log(`Borrow Rate: ${config.borrowRate.toString()} bps (${Number(config.borrowRate) / 100}% APR)`);
  console.log(`Supply Rate: ${config.supplyRate.toString()} bps (${Number(config.supplyRate) / 100}% APR)`);
  console.log(`Supply Index: ${config.supplyIndex.toString()}`);
  console.log(`Borrow Index: ${config.borrowIndex.toString()}`);
  console.log(`Total Supply: ${config.totalSupply.toString()}`);
  console.log(`Total Borrow: ${config.totalBorrow.toString()}`);

  if (!config.enabled) {
    console.log(`\n❌ Token is NOT configured!`);
    console.log(`\nTo configure, run:`);
    console.log(`npx hardhat console --network sapphireTestnet`);
    console.log(`> const core = await ethers.getContractAt("LendingCore", "${coreAddress}")`);
    console.log(`> await core.configureToken("${tokenAddress}", 7500, 8000, 1000, 500)`);
    console.log(`\nParameters:`);
    console.log(`  - LTV: 7500 (75%)`);
    console.log(`  - Liquidation Threshold: 8000 (80%)`);
    console.log(`  - Borrow Rate: 1000 (10% APR)`);
    console.log(`  - Supply Rate: 500 (5% APR)`);
  } else {
    console.log(`\n✅ Token is configured and enabled.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

