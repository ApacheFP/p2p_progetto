import { ethers } from "hardhat";
import { expect } from "chai";
import { TrustToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TrustToken Contract", function () {
  let token: TrustToken;
  let owner: HardhatEthersSigner, user1: HardhatEthersSigner, user2: HardhatEthersSigner;

  // Prima di ogni test, deploya il contratto e ottieni i firmatari
  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const TokenFactory = await ethers.getContractFactory("TrustToken");
    token = await TokenFactory.deploy();
  });

  describe("Deployment and Minting", function () {
    it("Should have correct name and symbol", async function () {
      expect(await token.name()).to.equal("Trust Token");
      expect(await token.symbol()).to.equal("TRUST");
    });

    it("Should allow users to mint tokens by sending ETH", async function () {
      const amountToSend = ethers.parseEther("1.0"); // 1 ETH
      const rate = await token.RATE();
      const expectedTokens = amountToSend * BigInt(rate);

      // Esegui la funzione e controlla l'evento
      await expect(token.connect(user1).mint({ value: amountToSend }))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, expectedTokens);

      // Controlla che il saldo dell'utente e la total supply siano corretti
      expect(await token.balanceOf(user1.address)).to.equal(expectedTokens);
      expect(await token.totalSupply()).to.equal(expectedTokens);
    });

    it("Should revert if trying to mint with 0 ETH", async function () {
      await expect(
        token.connect(user1).mint({ value: 0 })
      ).to.be.revertedWith("TrustToken: must send ETH to mint tokens");
    });
  });

  // NUOVA SEZIONE: Test delle funzionalità standard ERC20
  describe("ERC20 Standard Functions", function () {
    const mintAmount = ethers.parseUnits("1000", 18); // 1000 tokens

    // Prima di ogni test in questa sezione, user1 minta 1000 token.
    beforeEach(async function () {
        const rate = await token.RATE();
        const ethAmount = mintAmount / BigInt(rate);
        await token.connect(user1).mint({ value: ethAmount });
    });

    it("Should allow users to transfer tokens", async function () {
      const transferAmount = ethers.parseUnits("100", 18);

      // user1 trasferisce 100 token a user2
      await expect(token.connect(user1).transfer(user2.address, transferAmount))
        .to.emit(token, "Transfer")
        .withArgs(user1.address, user2.address, transferAmount);

      // Controlla i saldi
      const finalBalanceUser1 = mintAmount - transferAmount;
      expect(await token.balanceOf(user1.address)).to.equal(finalBalanceUser1);
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("Should revert a transfer if the sender has insufficient balance", async function () {
      const excessiveAmount = ethers.parseUnits("1001", 18); // Più di quanto possiede

      // Ci aspettiamo che il trasferimento fallisca con l'errore standard di OpenZeppelin
      await expect(token.connect(user1).transfer(user2.address, excessiveAmount))
        .to.be.revertedWithCustomError(token, "ERC20InsufficientBalance");
    });

    it("Should handle approve and transferFrom correctly", async function () {
      const allowanceAmount = ethers.parseUnits("200", 18);
      const transferAmount = ethers.parseUnits("150", 18);

      // 1. user1 (il proprietario dei token) approva 'owner' a spendere 200 dei suoi token
      await expect(token.connect(user1).approve(owner.address, allowanceAmount))
        .to.emit(token, "Approval")
        .withArgs(user1.address, owner.address, allowanceAmount);
      
      // Controlla l'allowance
      expect(await token.allowance(user1.address, owner.address)).to.equal(allowanceAmount);
      
      // 2. 'owner' (lo spender) trasferisce 150 token da user1 a user2
      await token.connect(owner).transferFrom(user1.address, user2.address, transferAmount);

      // Controlla i saldi finali
      const finalBalanceUser1 = mintAmount - transferAmount;
      expect(await token.balanceOf(user1.address)).to.equal(finalBalanceUser1);
      expect(await token.balanceOf(user2.address)).to.equal(transferAmount);

      // Controlla l'allowance rimanente
      const remainingAllowance = allowanceAmount - transferAmount;
      expect(await token.allowance(user1.address, owner.address)).to.equal(remainingAllowance);
    });

    it("Should revert transferFrom if spender has insufficient allowance", async function () {
        const transferAmount = ethers.parseUnits("50", 18);
        // user1 non ha approvato 'owner', quindi l'allowance è 0.

        await expect(token.connect(owner).transferFrom(user1.address, user2.address, transferAmount))
            .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });
  });
});