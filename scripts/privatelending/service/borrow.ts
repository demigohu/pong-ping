import { ethers } from "hardhat";
import { encodeEnvelope, getSigner, parseCommon } from "./utils";

async function main() {
  const { ingress, destinationDomain, pubKey, tokenType, tokenAddress, decimals } =
    parseCommon();
  const amountInput = process.env.AMOUNT;
  const depositId = process.env.DEPOSIT_ID as string;
  const onBehalf = process.env.ON_BEHALF;
  if (!amountInput) throw new Error("Set AMOUNT");
  if (!depositId) throw new Error("Set DEPOSIT_ID (collateral deposit)");

  const amount = ethers.parseUnits(amountInput, decimals);
  if (amount === 0n) throw new Error("Amount must be > 0");

  const signer = await getSigner();
  const sender = await signer.getAddress();

  const contract = await ethers.getContractAt(
    "PrivateLendingIngress",
    ingress,
    signer
  );

  // Basic off-chain checks
  const dep = await contract.deposits(depositId);
  if (dep.depositor.toLowerCase() !== sender.toLowerCase()) {
    throw new Error(`Deposit belongs to ${dep.depositor}, not ${sender}`);
  }
  if (dep.released) throw new Error("Deposit already released");
  if (dep.isNative !== (tokenType === "native"))
    throw new Error("Deposit type mismatch");
  if (!dep.isNative && tokenAddress && dep.token.toLowerCase() !== tokenAddress.toLowerCase()) {
    throw new Error("Deposit token mismatch");
  }

  const resolvedOnBehalf = onBehalf && onBehalf !== "" ? onBehalf : sender;
  if (!ethers.isAddress(resolvedOnBehalf)) {
    throw new Error(`Invalid ON_BEHALF address: ${resolvedOnBehalf}`);
  }

  const payload = {
    actionType: 1, // BORROW
    token: tokenType === "native" ? ethers.ZeroAddress : (tokenAddress as string),
    amount,
    onBehalf: resolvedOnBehalf,
    depositId,
    isNative: tokenType === "native",
    memo: ethers.toUtf8Bytes(process.env.PRIVATE_MEMO ?? ""),
  };

  const plaintext = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(uint8 actionType,address token,uint256 amount,address onBehalf,bytes32 depositId,bool isNative,bytes memo)",
    ],
    [payload]
  );

  const { envelopeBytes } = encodeEnvelope(ethers.getBytes(plaintext), pubKey);
  
  // submitAction returns actionId, but we need to call it and wait for receipt to get the value
  // Since we can't easily get return value from transaction, we'll get it from event/mapping
  const tx = await contract.submitAction(destinationDomain, depositId, envelopeBytes);
  console.log(`submitAction borrow tx: ${tx.hash}`);
  const receipt = await tx.wait();
  
  // Get actionId from event EncryptedActionReceived -> lookup ciphertextHashToActionId
  const logs = receipt?.logs ?? [];
  let actionId: string | null = null;
  
  const ev = logs.find((log: any) => {
    try {
      const parsed = contract.interface.parseLog(log);
      return parsed?.name === "EncryptedActionReceived";
    } catch {
      return false;
    }
  });
  
  if (ev) {
    const parsed = contract.interface.parseLog(ev as any);
    if (parsed) {
      const encryptedDataHash = parsed.args.encryptedDataHash;
      actionId = await contract.ciphertextHashToActionId(encryptedDataHash);
    }
  }
  
  if (actionId) {
    console.log(`✅ Action ID: ${actionId}`);
    console.log(`\nTo process this action on Sapphire, run:`);
    console.log(`CORE_ADDRESS=0x... ACTION_ID=${actionId} npx hardhat run scripts/privatelending/service/processAction.ts --network sapphireTestnet`);
  } else {
    console.log(`⚠️  Could not get ACTION_ID automatically.`);
    console.log(`   You can get it by querying Ingress.ciphertextHashToActionId(encryptedDataHash) on Mantle,`);
    console.log(`   or by listening to EncryptedActionStored event on Sapphire.`);
  }
  
  console.log("Borrow action dispatched (release will happen after Sapphire check).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


