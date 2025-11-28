import { ethers } from "hardhat";
import { X25519DeoxysII } from "@oasisprotocol/sapphire-paratime";

const erc20Abi = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

async function main() {
  const ingressAddress = process.env.INGRESS_ADDRESS as string;
  const destinationDomain = Number(process.env.SAPPHIRE_DOMAIN ?? "23295");
  const vaultPublicKey = process.env.VAULT_PUBLIC_KEY;
  const receiver = process.env.RECEIVER;
  const amountInput = process.env.AMOUNT;
  const tokenType = (process.env.TOKEN_TYPE ?? "native").toLowerCase();
  const isNative = tokenType === "native";
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const memo = process.env.PRIVATE_MEMO ?? "";

  if (!ingressAddress) {
    throw new Error("Set INGRESS_ADDRESS env var");
  }
  if (!vaultPublicKey || !ethers.isHexString(vaultPublicKey, 32)) {
    throw new Error(
      "Set VAULT_PUBLIC_KEY env var to the vault's 32-byte public key (hex)"
    );
  }
  if (!receiver) {
    throw new Error("Set RECEIVER env var");
  }
  if (!amountInput) {
    throw new Error("Set AMOUNT env var");
  }
  if (!isNative && !tokenAddress) {
    throw new Error("Set TOKEN_ADDRESS env var for ERC20 transfers");
  }

  const decimals = Number(
    process.env.TOKEN_DECIMALS ?? (isNative ? "18" : "6")
  );
  if (Number.isNaN(decimals)) {
    throw new Error("Invalid TOKEN_DECIMALS value");
  }
  
  // Debug logging
  console.log(`\n=== Transfer Configuration ===`);
  console.log(`AMOUNT (raw): "${amountInput}"`);
  console.log(`TOKEN_DECIMALS: ${decimals}`);
  console.log(`TOKEN_TYPE: ${tokenType}`);
  
  const amount = ethers.parseUnits(amountInput, decimals);
  console.log(`Amount (parsed): ${amount.toString()} wei`);
  console.log(`Amount (formatted): ${ethers.formatUnits(amount, decimals)} ${isNative ? "MNT" : "tokens"}`);
  
  if (amount === 0n) {
    throw new Error("Amount must be greater than zero");
  }

  const memoBytes = ethers.toUtf8Bytes(memo);
  const payload = {
    receiver,
    token: isNative ? ethers.ZeroAddress : (tokenAddress as string),
    amount,
    isNative,
    memo: memoBytes,
  };

  const plaintext = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(address receiver,address token,uint256 amount,bool isNative,bytes memo)"],
    [payload]
  );

  const plainBytes = ethers.getBytes(plaintext);
  const cipher = X25519DeoxysII.ephemeral(
    ethers.getBytes(vaultPublicKey)
  );
  const { nonce, ciphertext } = cipher.encrypt(plainBytes);

  // Ensure senderPublicKey is exactly 32 bytes (bytes32)
  const senderPublicKeyBytes = ethers.getBytes(cipher.publicKey);
  if (senderPublicKeyBytes.length !== 32) {
    throw new Error(
      `Invalid public key length: ${senderPublicKeyBytes.length}, expected 32`
    );
  }
  
  // Ensure nonce is exactly 16 bytes (bytes16)
  // X25519DeoxysII.encrypt returns nonce as Uint8Array, need to ensure it's exactly 16 bytes
  let nonceBytes = ethers.getBytes(nonce);
  const rawNonceHex = ethers.hexlify(nonceBytes);
  if (nonceBytes.length !== 15 && nonceBytes.length !== 16) {
    throw new Error(
      `Unexpected nonce length: ${nonceBytes.length}. Expected 15 bytes (Deoxys-II nonce).`
    );
  }
  // Deoxys-II nonce is 15 bytes; Sapphire expects bytes16 (and only reads first 15 bytes).
  // If the library returns 15 bytes, append a zero byte at the end so the leading bytes stay intact.
  if (nonceBytes.length === 15) {
    const padded = new Uint8Array(16);
    padded.set(nonceBytes, 0);
    nonceBytes = padded;
  }
  
  // Debug logging
  console.log(`\n=== Envelope Debug ===`);
  console.log(`SenderPublicKey: ${ethers.hexlify(senderPublicKeyBytes)}`);
  console.log(`SenderPublicKey bytes: ${senderPublicKeyBytes.length}`);
  console.log(`Nonce (raw): ${rawNonceHex}`);
  console.log(`Nonce bytes: ${nonceBytes.length}`);
  console.log(`Ciphertext length: ${ciphertext.length} bytes`);
  
  const envelope = {
    senderPublicKey: senderPublicKeyBytes,
    nonce: nonceBytes,
    ciphertext,
  };

  const encodedEnvelope = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32 senderPublicKey, bytes16 nonce, bytes ciphertext)"],
    [envelope]
  );

  const testerPk =
    process.env.TESTER_PRIVATE_KEY ??
    process.env.PRIVATE_KEY_2 ??
    process.env.SENDER_PRIVATE_KEY;
  const signer = testerPk
    ? new ethers.Wallet(testerPk, ethers.provider)
    : await ethers.provider.getSigner();
  const senderAddress = await signer.getAddress();
  console.log(`Using signer: ${senderAddress}`);

  const contract = await ethers.getContractAt(
    "PrivateTransferIngress",
    ingressAddress,
    signer
  );

  const envelopeBytes = ethers.getBytes(encodedEnvelope);
  const gasFee = ethers.parseEther(process.env.DISPATCH_GAS_FEE ?? "0");

  let tx;
  if (isNative) {
    const depositAmount = amount;
    const totalValue = depositAmount + gasFee;
    console.log(`\n=== Native Transfer Details ===`);
    console.log(`Deposit Amount: ${ethers.formatEther(depositAmount)} MNT`);
    console.log(`Gas Fee: ${ethers.formatEther(gasFee)} MNT`);
    console.log(`Total Value: ${ethers.formatEther(totalValue)} MNT`);
    console.log(`\nSending transaction...`);
    tx = await contract.initiateNativeTransfer(
      destinationDomain,
      envelopeBytes,
      depositAmount,
      {
        value: totalValue,
      }
    );
  } else {
    const token = await ethers.getContractAt(
      erc20Abi,
      tokenAddress as string,
      signer
    );
    const owner = await signer.getAddress();
    const allowance = await token.allowance(owner, ingressAddress);
    if (allowance < amount) {
      const approveTx = await token.approve(ingressAddress, amount);
      await approveTx.wait();
    }
    tx = await contract.initiateErc20Transfer(
      destinationDomain,
      tokenAddress,
      amount,
      envelopeBytes,
      {
        value: gasFee,
      }
    );
  }

  console.log("Dispatching encrypted payload and locking funds...");
  const receipt = await tx.wait();
  
  // Extract transferId from event
  const event = receipt?.logs.find((log: any) => {
    try {
      const parsed = contract.interface.parseLog(log);
      return parsed?.name === "PrivateTransferInitiated";
    } catch {
      return false;
    }
  });
  
  if (event) {
    const parsed = contract.interface.parseLog(event);
    const transferId = parsed?.args.transferId;
    console.log(`Transfer dispatched in tx ${receipt?.hash}`);
    console.log(`TRANSFER_ID: ${transferId}`);
    console.log(`\nUse this TRANSFER_ID for ackTransfer.ts:`);
    console.log(`TRANSFER_ID=${transferId} npx hardhat run scripts/privatetransfer/service/ackTransfer.ts --network sapphireTestnet`);
  } else {
    console.log(`Transfer dispatched in tx ${receipt?.hash}`);
    console.log(`Note: Could not extract TRANSFER_ID from event. Query it from event logs.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

