import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "paris",
      optimizer: {
        enabled: true,
        runs: 200, // Lower runs = smaller bytecode, higher gas cost (good for deployment)
      },
    },
  },
  sourcify: {
    enabled: true,
    // Optional: specify a different Sourcify server
    apiUrl: "https://sourcify.dev/server",
    // Optional: specify a different Sourcify repository
    browserUrl: "https://repo.sourcify.dev",
  },
  networks: {
    mantleSepolia: {
      url: process.env.MANTLE_SEPOLIA_RPC ?? "https://rpc.sepolia.mantle.xyz",
      chainId: 5003,
      accounts,
    },
    sapphireTestnet: {
      url: process.env.SAPPHIRE_TESTNET_RPC ?? "https://testnet.sapphire.oasis.io",
      chainId: 23295,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      mantleSepolia: process.env.MANTLESCAN_API_KEY ?? "",
      sapphireTestnet: process.env.SAPPHIRE_EXPLORER_API_KEY ?? "",
    },
    customChains: [
      {
        network: "mantleSepolia",
        chainId: 5003,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://sepolia.mantlescan.xyz",
        },
      },
      {
        network: "sapphireTestnet",
        chainId: 23295,
        urls: {
          apiURL: "https://explorer.oasis.io/testnet/sapphire/api",
          browserURL: "https://explorer.oasis.io/testnet/sapphire",
        },
      },
    ],
  },
};

export default config;
