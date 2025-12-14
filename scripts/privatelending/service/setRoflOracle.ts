import { ethers } from "hardhat";

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const token = process.env.TOKEN_ADDRESS as string || ethers.ZeroAddress; // Default to native
  const roflOracle = process.env.ROFL_ORACLE_ADDRESS as string;

  if (!coreAddress) {
    throw new Error("Set CORE_ADDRESS env var.");
  }
  if (!roflOracle) {
    throw new Error("Set ROFL_ORACLE_ADDRESS env var.");
  }

  const contract = await ethers.getContractAt("LendingCore", coreAddress);
  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();

  console.log(`\n=== Set ROFL Oracle ===`);
  console.log(`LendingCore: ${coreAddress}`);
  console.log(`Token: ${token}`);
  console.log(`ROFL Oracle: ${roflOracle}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Is Signer Owner: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  if (signerAddress.toLowerCase() !== owner.toLowerCase()) {
    throw new Error("Only owner can set ROFL Oracle");
  }

  try {
    const tx = await contract.setRoflOracle(token, roflOracle);
    console.log(`Transaction hash: ${tx.hash}`);
    await tx.wait();
    console.log(`✅ ROFL Oracle set for token ${token}`);
    
    // Verify
    const setOracle = await contract.roflOracles(token);
    console.log(`\n=== Verification ===`);
    console.log(`ROFL Oracle for token ${token}: ${setOracle}`);
    if (setOracle.toLowerCase() !== roflOracle.toLowerCase()) {
      throw new Error("ROFL Oracle not set correctly");
    }
  } catch (error: any) {
    console.error(`❌ Failed to set ROFL Oracle: ${error.message}`);
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

