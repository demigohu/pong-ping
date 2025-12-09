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
  const useDepositId = process.env.DEPOSIT_ID; // optional: skip deposit step if provided

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
    process.env.TOKEN_DECIMALS ?? (tokenType === "native" ? "18" : "6")
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

  const signerPk =
    process.env.TESTER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_2 ||
    process.env.SENDER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;
  const signer = signerPk
    ? new ethers.Wallet(signerPk, ethers.provider)
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
  let depositId: string | undefined;

  if (useDepositId) {
    depositId = useDepositId;
    console.log(`Using provided depositId: ${depositId}`);
    // Validate ownership early to avoid revert
    try {
      const dep = await contract.deposits(depositId);
      if (dep.depositor.toLowerCase() !== senderAddress.toLowerCase()) {
        throw new Error(
          `Deposit belongs to ${dep.depositor}, not ${senderAddress} (not your deposit)`
        );
      }
      if (dep.released) {
        throw new Error(`Deposit already used/released`);
      }
      if (dep.isNative !== isNative) {
        throw new Error(`Deposit type mismatch (expected ${isNative ? "native" : "erc20"})`);
      }
      if (!dep.isNative && tokenAddress && dep.token.toLowerCase() !== tokenAddress.toLowerCase()) {
        throw new Error(`Deposit token mismatch. Deposit token: ${dep.token}, input token: ${tokenAddress}`);
      }
      if (dep.amount < amount) {
        throw new Error(
          `Deposit insufficient: remaining ${dep.amount.toString()} < requested ${amount.toString()}`
        );
      }
      console.log(
        `Deposit check: token=${dep.token}, amount=${dep.amount.toString()}, isNative=${dep.isNative}`
      );
    } catch (e) {
      throw new Error(`Deposit validation failed: ${(e as Error).message}`);
    }
  } else if (isNative) {
    console.log(`\n=== Step 1: Deposit Funds (Umbra-like Pattern) ===`);
    const depositAmount = amount;
    const depositTx = await contract.depositNative({
      value: depositAmount,
    });
    console.log(`Deposit tx: ${depositTx.hash}`);
    const depositReceipt = await depositTx.wait();
    
    const depositEvent = depositReceipt?.logs.find((log: any) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed?.name === "DepositCreated";
      } catch {
        return false;
      }
    });
    
    if (!depositEvent) {
      throw new Error("Could not find DepositCreated event");
    }
    
    const parsedDeposit = contract.interface.parseLog(depositEvent);
    depositId = parsedDeposit?.args.depositId;
    console.log(`Deposit ID: ${depositId}`);
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

    console.log(`\n=== Step 1: Deposit ERC20 (Umbra-like Pattern) ===`);
    const depositTx = await contract.depositErc20(tokenAddress as string, amount);
    console.log(`Deposit tx: ${depositTx.hash}`);
    const depositReceipt = await depositTx.wait();

    const depositEvent = depositReceipt?.logs.find((log: any) => {
      try {
        const parsed = contract.interface.parseLog(log);
        return parsed?.name === "DepositCreated";
      } catch {
        return false;
      }
    });

    if (!depositEvent) {
      throw new Error("Could not find DepositCreated event (ERC20)");
    }

    const parsedDeposit = contract.interface.parseLog(depositEvent);
    depositId = parsedDeposit?.args.depositId;
    console.log(`Deposit ID: ${depositId}`);
  }

  if (!depositId) {
    throw new Error("depositId not available");
  }

  console.log(`\n=== Step 2: Initiate Transfer (Only Encrypted Instructions) ===`);
  console.log(`Only encrypted instructions in call data - persis seperti Umbra!`);
  console.log(`No amount visible in transfer initiation - amount already in contract from deposit`);

  tx = await contract.initiateTransfer(
    destinationDomain,
    depositId,
    ethers.getBytes(encodedEnvelope)
  );

  console.log("Dispatching encrypted payload and locking funds...");
  const receipt = await tx.wait();
  
  // Extract encrypted hash and transferId
  let encryptedDataHash: string | undefined;
  const event = receipt?.logs.find((log: any) => {
    try {
      const parsed = contract.interface.parseLog(log);
      return parsed?.name === "EncryptedInstructionsReceived";
    } catch {
      return false;
    }
  });
  
  if (event) {
    const parsed = contract.interface.parseLog(event);
    encryptedDataHash = parsed?.args.encryptedDataHash;
    console.log(`Transfer dispatched in tx ${receipt?.hash}`);
    console.log(`Encrypted Data Hash: ${encryptedDataHash}`);
    console.log(`\n✅ Umbra-like pattern: Only encrypted instructions hash visible in event!`);
  } else {
    console.log(`Transfer dispatched in tx ${receipt?.hash}`);
    console.log(`Note: Could not extract event. Query from event logs.`);
  }

  let transferId: string | undefined;
  if (encryptedDataHash) {
    try {
      transferId = await contract.getTransferIdByCiphertextHash(encryptedDataHash);
      if (transferId === ethers.ZeroHash) transferId = undefined;
    } catch (e) {
      console.log("Could not fetch transferId by hash:", (e as Error).message);
    }
  }

  if (transferId) {
    console.log(`TRANSFER_ID (lookup via hash): ${transferId}`);
  } else {
    console.log("TRANSFER_ID not resolved. You can query getTransferIdByCiphertextHash(hash).");
  }

  // Ack dilakukan manual (script ini tidak auto-ack). Gunakan ackTransfer.ts dengan TRANSFER_ID.
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

