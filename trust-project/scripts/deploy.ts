import { ethers } from "hardhat";

async function main() {
  // 1. Deploy del contratto TrustToken
  const TrustToken = await ethers.getContractFactory("TrustToken");
  const trustToken = await TrustToken.deploy();
  await trustToken.waitForDeployment();
  console.log(`TrustToken deployato a: ${trustToken.target}`);

  // 2. Deploy del contratto TrustManager, passando l'indirizzo del token
  const TrustManager = await ethers.getContractFactory("TrustManager");
  const trustManager = await TrustManager.deploy(trustToken.target);
  await trustManager.waitForDeployment();
  console.log(`TrustManager deployato a: ${trustManager.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});