import { ethers } from "hardhat";
import { X25519DeoxysII } from "@oasisprotocol/sapphire-paratime";

export type TokenType = "native" | "erc20";

export function parseCommon() {
  const ingress = process.env.INGRESS_ADDRESS as string;
  const destinationDomain = Number(process.env.SAPPHIRE_DOMAIN ?? "23295");
  const pubKey = process.env.LENDING_PUBLIC_KEY;
  const tokenType = (process.env.TOKEN_TYPE ?? "native").toLowerCase() as TokenType;
  const tokenAddress = process.env.TOKEN_ADDRESS;
  const decimals = Number(
    process.env.TOKEN_DECIMALS ?? (tokenType === "native" ? "18" : "6")
  );

  if (!ingress) throw new Error("Set INGRESS_ADDRESS env var");
  if (!pubKey || !ethers.isHexString(pubKey, 32)) {
    throw new Error("Set LENDING_PUBLIC_KEY (32-byte hex from LendingCore.vaultPublicKey)");
  }
  if (tokenType !== "native" && tokenType !== "erc20") {
    throw new Error("TOKEN_TYPE must be native or erc20");
  }
  if (tokenType === "erc20" && !tokenAddress) {
    throw new Error("Set TOKEN_ADDRESS for erc20");
  }
  if (Number.isNaN(decimals)) throw new Error("Invalid TOKEN_DECIMALS");

  return { ingress, destinationDomain, pubKey, tokenType, tokenAddress, decimals };
}

export function encodeEnvelope(plaintext: Uint8Array, pubKey: string) {
  const cipher = X25519DeoxysII.ephemeral(ethers.getBytes(pubKey));
  const { nonce, ciphertext } = cipher.encrypt(plaintext);

  let nonceBytes = ethers.getBytes(nonce);
  if (nonceBytes.length === 15) {
    const padded = new Uint8Array(16);
    padded.set(nonceBytes, 0);
    nonceBytes = padded;
  }
  if (nonceBytes.length !== 16) {
    throw new Error(`Unexpected nonce length: ${nonceBytes.length}`);
  }

  const senderPublicKeyBytes = ethers.getBytes(cipher.publicKey);
  if (senderPublicKeyBytes.length !== 32) {
    throw new Error(`Invalid sender pubkey length: ${senderPublicKeyBytes.length}`);
  }

  const envelope = {
    senderPublicKey: senderPublicKeyBytes,
    nonce: nonceBytes,
    ciphertext,
  };

  const encodedEnvelope = ethers.AbiCoder.defaultAbiCoder().encode(
    ["tuple(bytes32 senderPublicKey, bytes16 nonce, bytes ciphertext)"],
    [envelope]
  );

  return { envelopeBytes: ethers.getBytes(encodedEnvelope), senderPublicKeyBytes };
}

export async function getSigner() {
  const signerPk =
    process.env.TESTER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_2 ||
    process.env.SENDER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;
  const signer = signerPk
    ? new ethers.Wallet(signerPk, ethers.provider)
    : await ethers.provider.getSigner();
  return signer;
}


