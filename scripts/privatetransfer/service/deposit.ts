import { ethers } from "hardhat";
import { parseUnits, formatUnits } from "ethers";

type CliArgs = Record<string, string | undefined>;

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const map: CliArgs = {};
  for (const arg of args) {
    const [k, v] = arg.split("=");
    if (k && v) map[k.replace(/^--/, "")] = v;
  }
  return map;
}

async function main() {
  const cli = parseArgs();
  const ingressAddress = cli.ingress || process.env.INGRESS_ADDRESS;
  const tokenType = (cli.type || process.env.TOKEN_TYPE || "native").toLowerCase();
  const amountInput = cli.amount || process.env.AMOUNT;
  const tokenAddress = cli.token || process.env.TOKEN_ADDRESS;
  const decimals =
    Number(cli.decimals || process.env.TOKEN_DECIMALS || (tokenType === "native" ? "18" : "6"));

  if (!ingressAddress) throw new Error("Set --ingress or INGRESS_ADDRESS");
  if (!amountInput) throw new Error("Set --amount or AMOUNT");
  if (Number.isNaN(decimals)) throw new Error("Invalid decimals");

  const amount = parseUnits(amountInput, decimals);
  if (amount === 0n) throw new Error("Amount must be greater than zero");

  const pk =
    cli.pk ||
    process.env.TESTER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY_2 ||
    process.env.SENDER_PRIVATE_KEY ||
    process.env.PRIVATE_KEY;
  const provider = new ethers.JsonRpcProvider(process.env.MANTLE_SEPOLIA_RPC);
  const signer = pk ? new ethers.Wallet(pk, provider) : (await ethers.getSigners())[0];
  console.log(`Using signer: ${await signer.getAddress()}`);

  let ingress = await ethers.getContractAt("PrivateTransferIngress", ingressAddress, signer);

  if (tokenType === "native") {
    console.log("\n=== Deposit Native ===");
    console.log(`Amount: ${formatUnits(amount, decimals)} MNT`);
    const tx = await ingress.depositNative({ value: amount });
    console.log(`Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    const ev = receipt?.logs
      .map((log) => {
        try {
          return ingress.interface.parseLog(log);
        } catch {
          return undefined;
        }
      })
      .find((p) => p?.name === "DepositCreated");
    if (!ev) {
      console.log("DepositId not found in events. Inspect tx logs.");
      return;
    }
    console.log(`DepositId: ${ev.args?.depositId}`);
  } else if (tokenType === "erc20") {
    if (!tokenAddress) throw new Error("Set --token or TOKEN_ADDRESS for ERC20");
    console.log("\n=== Deposit ERC20 ===");
    console.log(`Token: ${tokenAddress}`);
    console.log(`Amount: ${formatUnits(amount, decimals)}`);
    const token = await ethers.getContractAt(
      ["function approve(address spender, uint256 amount) external returns (bool)"],
      tokenAddress,
      signer
    );
    const approveTx = await token.approve(ingressAddress, amount);
    await approveTx.wait();
    const tx = await ingress.depositErc20(tokenAddress, amount);
    console.log(`Tx: ${tx.hash}`);
    const receipt = await tx.wait();
    const ev = receipt?.logs
      .map((log) => {
        try {
          return ingress.interface.parseLog(log);
        } catch {
          return undefined;
        }
      })
      .find((p) => p?.name === "DepositCreated");
    if (!ev) {
      console.log("DepositId not found in events. Inspect tx logs.");
      return;
    }
    console.log(`DepositId: ${ev.args?.depositId}`);
  } else {
    throw new Error("Unknown type. Use --type native|erc20");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


