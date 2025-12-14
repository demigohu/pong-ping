import { ethers } from "hardhat";

async function main() {
  const coreAddress = process.env.CORE_ADDRESS as string;
  const actionId = process.env.ACTION_ID as string;

  if (!coreAddress || !actionId) {
    throw new Error("Set CORE_ADDRESS and ACTION_ID env vars.");
  }

  const contract = await ethers.getContractAt("LendingCore", coreAddress);
  const signer = await ethers.provider.getSigner();
  const signerAddress = await signer.getAddress();
  const owner = await contract.owner();

  console.log(`\n=== Pre-flight Checks ===`);
  console.log(`LendingCore: ${coreAddress}`);
  console.log(`Action ID: ${actionId}`);
  console.log(`Signer: ${signerAddress}`);
  console.log(`Owner: ${owner}`);
  console.log(`Is Signer Owner: ${signerAddress.toLowerCase() === owner.toLowerCase()}`);

  // Check action exists
  const action = await contract.encryptedActions(actionId);
  console.log(`\nAction exists: ${action.envelope.ciphertext.length > 0}`);
  console.log(`Already processed: ${action.processed}`);
  console.log(`Origin Domain: ${action.originDomain}`);
  console.log(`Origin Router: ${ethers.hexlify(action.originRouter)}`);

  if (action.processed) {
    throw new Error("Action already processed!");
  }

  if (action.envelope.ciphertext.length === 0) {
    throw new Error("Action not found! Make sure relayer has forwarded the message from Mantle.");
  }

  // Try to decrypt and check token config before processing
  try {
    console.log(`\nPre-check: Attempting to decrypt payload...`);
    // Try static call to see if decrypt works
    await contract.processAction.staticCall(actionId, { value: 0 });
  } catch (preCheckError: any) {
    console.log(`\n⚠️  Pre-check failed: ${preCheckError.message}`);
    
    // Try to decode revert reason
    if (preCheckError.data) {
      try {
        const decoded = contract.interface.parseError(preCheckError.data);
        console.log(`Revert reason: ${decoded?.name} - ${decoded?.args}`);
      } catch {
        // Try to get reason from error message
        if (preCheckError.reason) {
          console.log(`Revert reason: ${preCheckError.reason}`);
        } else if (preCheckError.message) {
          // Check common error messages
          const msg = preCheckError.message.toLowerCase();
          if (msg.includes("token not enabled")) {
            console.log(`\n❌ Token not configured! Run configureToken first:`);
            console.log(`   npx hardhat console --network sapphireTestnet`);
            console.log(`   > await core.configureToken(tokenAddress, ltv, liquidationThreshold, borrowRate, supplyRate)`);
          } else if (msg.includes("decrypt")) {
            console.log(`\n❌ Decrypt failed! Check if LENDING_PUBLIC_KEY matches LendingCore's public key.`);
          }
        }
      }
    }
    
    // Don't throw yet, try to get more info
  }

  // Estimate gas first
  try {
    console.log(`\nEstimating gas...`);
    const gasEstimate = await contract.processAction.estimateGas(actionId, {
      value: 0,
    });
    console.log(`✅ Gas estimate: ${gasEstimate.toString()}`);
  } catch (estimateError: any) {
    console.log(`❌ Gas estimation failed: ${estimateError.message}`);
    if (estimateError.reason) {
      console.log(`Reason: ${estimateError.reason}`);
    }
    if (estimateError.data) {
      console.log(`Error data: ${estimateError.data}`);
      // Try to decode error
      try {
        const decoded = contract.interface.parseError(estimateError.data);
        console.log(`Decoded error: ${decoded?.name} - ${decoded?.args}`);
      } catch {}
    }
    throw estimateError;
  }

  console.log(`\nSending transaction...`);
  const tx = await contract.processAction(actionId as `0x${string}`, {
    value: 0,
  });
  console.log(`Transaction hash: ${tx.hash}`);
  console.log(`Waiting for confirmation...`);
  
  let receipt;
  try {
    receipt = await tx.wait();
  } catch (waitError: any) {
    console.log(`\n❌ Transaction reverted!`);
    console.log(`Hash: ${tx.hash}`);
    
    // Try to get revert reason from receipt
    if (waitError.receipt) {
      receipt = waitError.receipt;
    }
    
    // Try to call static to get revert reason
    try {
      await contract.processAction.staticCall(actionId, { value: 0 });
    } catch (staticError: any) {
      if (staticError.data) {
        try {
          const decoded = contract.interface.parseError(staticError.data);
          console.log(`\nRevert reason: ${decoded?.name}`);
          if (decoded?.args && decoded.args.length > 0) {
            console.log(`Args: ${decoded.args.join(", ")}`);
          }
        } catch {
          if (staticError.reason) {
            console.log(`\nRevert reason: ${staticError.reason}`);
          } else if (staticError.message) {
            const msg = staticError.message.toLowerCase();
            if (msg.includes("token not enabled")) {
              console.log(`\n❌ Token not configured!`);
              console.log(`   Run: npx hardhat console --network sapphireTestnet`);
              console.log(`   > await core.configureToken(tokenAddress, 7500, 8000, 1000, 500)`);
            } else if (msg.includes("decrypt")) {
              console.log(`\n❌ Decrypt failed! Check LENDING_PUBLIC_KEY.`);
            } else {
              console.log(`\nError: ${staticError.message}`);
            }
          }
        }
      }
    }
    
    throw waitError;
  }
  
  if (receipt?.status === 1) {
    console.log(`✅ Action processed! Release instruction dispatched in tx ${receipt?.hash}`);
    
    // Try to get processed payload info
    try {
      const payload = await contract.processedPayloads(actionId);
      console.log(`\n=== Processed Action Info ===`);
      console.log(`Action Type: ${payload.actionType} (0=SUPPLY, 1=BORROW, 2=REPAY, 3=WITHDRAW, 4=LIQUIDATE)`);
      console.log(`Token: ${payload.token}`);
      console.log(`Amount: ${payload.amount.toString()}`);
      console.log(`On Behalf: ${payload.onBehalf}`);
      console.log(`Deposit ID: ${payload.depositId}`);
    } catch (e) {
      console.log(`Could not fetch processed payload: ${(e as Error).message}`);
    }
  } else {
    throw new Error(`Transaction failed with status ${receipt?.status}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

