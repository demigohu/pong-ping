import { ethers } from "hardhat";

async function main() {
  const contractAddr = "0x4C2c941D37d1C2D1CB2b23A76a0df5233c971009";
  const signer = await ethers.provider.getSigner();
  const contract = await ethers.getContractAt("Ping", contractAddr, signer);

  const spinner = ['-', '\\', '|', '/'];
  let spinnerIndex = 0;
  const interval = setInterval(() => {
      process.stdout.write(`\rListening for event... ${spinner[spinnerIndex]}`);
      spinnerIndex = (spinnerIndex + 1) % spinner.length;
  }, 150);

  const filter = contract.filters.ReceivedPing();
  const window = 5;
  let events;
  do {
    const latest = await ethers.provider.getBlockNumber();
    const fromBlock = latest > window ? latest - window : 0;
    events = await contract.queryFilter(filter, fromBlock, latest);
    if (events.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  } while (events.length === 0);
  
  clearInterval(interval);
  process.stdout.write(`\r`); 
  process.stdout.clearLine(0);

  const parsedEvent = contract.interface.parseLog(events[0]);
  const message = parsedEvent?.args?.message;
  console.log(`Message received with: ${message}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});