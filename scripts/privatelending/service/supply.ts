import { ethers } from "hardhat";
import { encodeEnvelope, getSigner, parseCommon, TokenType } from "./utils";

const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

async function main() {
  const { ingress, destinationDomain, pubKey, tokenType, tokenAddress, decimals } =
    parseCommon();
  const amountInput = process.env.AMOUNT;
  if (!amountInput) throw new Error("Set AMOUNT");

  const amount = ethers.parseUnits(amountInput, decimals);
  if (amount === 0n) throw new Error("Amount must be > 0");

  const signer = await getSigner();
  const sender = await signer.getAddress();
  // Ambil nonce pending sekali di awal, lalu kelola manual supaya tidak bentrok
  let nextNonce = await signer.getNonce("pending");

  const contract = await ethers.getContractAt(
    "PrivateLendingIngress",
    ingress,
    signer
  );

  let depositId: string;

  if (tokenType === "native") {
    const tx = await contract.depositNative({ value: amount, nonce: nextNonce++ });
    const rcpt = await tx.wait();
    const logs = rcpt?.logs ?? [];
    const ev = logs.find((log: any) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed?.name === "DepositCreated";
      } catch {
        return false;
      }
    });
    if (!ev) throw new Error("DepositCreated event not found");
    const parsed = contract.interface.parseLog(ev as any);
    if (!parsed) throw new Error("Failed to parse DepositCreated log");
    depositId = parsed.args.depositId;
    console.log(`Deposit native ok. depositId=${depositId}`);
  } else {
    const token = await ethers.getContractAt(erc20Abi, tokenAddress as string, signer);
    const allowance = await token.allowance(sender, ingress);
    if (allowance < amount) {
      const approveTx = await token.approve(ingress, amount, { nonce: nextNonce++ });
      await approveTx.wait();
    }
    const tx = await contract.depositErc20(tokenAddress as string, amount, {
      nonce: nextNonce++,
    });
    const rcpt = await tx.wait();
    const logs = rcpt?.logs ?? [];
    const ev = logs.find((log: any) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed?.name === "DepositCreated";
      } catch {
        return false;
      }
    });
    if (!ev) throw new Error("DepositCreated event not found");
    const parsed = contract.interface.parseLog(ev as any);
    if (!parsed) throw new Error("Failed to parse DepositCreated log");
    depositId = parsed.args.depositId;
    console.log(`Deposit erc20 ok. depositId=${depositId}`);
  }

  // Build payload: ActionType.SUPPLY = 0
  const payload = {
    actionType: 0,
    token: tokenType === "native" ? ethers.ZeroAddress : (tokenAddress as string),
    amount,
    onBehalf: sender,
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
  const tx2 = await contract.submitAction(destinationDomain, depositId, envelopeBytes, {
    nonce: nextNonce++,
  });
  console.log(`submitAction tx: ${tx2.hash}`);
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
    console.log(`   You can get it by querying Ingress.ciphertextHashToActionId(encryptedDataHash) on Mantle,`);
    console.log(`   or by listening to EncryptedActionStored event on Sapphire.`);
  }
  
  console.log("Supply action dispatched.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});


