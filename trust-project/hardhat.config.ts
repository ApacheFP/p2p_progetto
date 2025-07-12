// hardhat.config.ts

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  gasReporter: {
    enabled: true,
    currency: 'USD',
    coinmarketcap: '5a92b004-e340-4c42-9710-a7650899ce65',
    etherscan: '5HEH2H851QCNFWSJUZYQ22K1DGEPX4VJHV',
    outputFile: 'gas-report.txt',
    noColors: true,
  },
};

export default config;