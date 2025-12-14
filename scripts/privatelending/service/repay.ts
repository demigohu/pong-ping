import { ethers } from "hardhat";
import { encodeEnvelope, getSigner, parseCommon } from "./utils";

const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

async function main() {
  const { ingress, destinationDomain, pubKey, tokenType, tokenAddress, decimals } =
    parseCommon();
  const amountInput = process.env.AMOUNT;
  const depositId = process.env.DEPOSIT_ID as string;
  const onBehalf = process.env.ON_BEHALF;
  if (!amountInput) throw new Error("Set AMOUNT");
  if (!depositId) throw new Error("Set DEPOSIT_ID (repay uses same deposit bucket)");

  const amount = ethers.parseUnits(amountInput, decimals);
  if (amount === 0n) throw new Error("Amount must be > 0");

  const signer = await getSigner();
  const sender = await signer.getAddress();

  const contract = await ethers.getContractAt(
    "PrivateLendingIngress",
    ingress,
    signer
  );

  if (tokenType === "native") {
    const tx = await contract.depositNative({ value: amount });
    await tx.wait();
  } else {
    const token = await ethers.getContractAt(erc20Abi, tokenAddress as string, signer);
    const allowance = await token.allowance(sender, ingress);
    if (allowance < amount) {
      const approveTx = await token.approve(ingress, amount);
      await approveTx.wait();
    }
    const tx = await contract.depositErc20(tokenAddress as string, amount);
    await tx.wait();
  }

  const resolvedOnBehalf = onBehalf && onBehalf !== "" ? onBehalf : sender;
  if (!ethers.isAddress(resolvedOnBehalf)) {
    throw new Error(`Invalid ON_BEHALF address: ${resolvedOnBehalf}`);
  }

  const payload = {
    actionType: 2, // REPAY
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
  const tx2 = await contract.submitAction(destinationDomain, depositId, envelopeBytes);
  console.log(`submitAction repay tx: ${tx2.hash}`);
  const receipt2 = await tx2.wait();
  
  // Get actionId from event EncryptedActionReceived -> lookup ciphertextHashToActionId
  const logs = receipt2?.logs ?? [];
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
  }
  
  console.log("Repay action dispatched.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


