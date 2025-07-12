import { ethers } from "hardhat";
import { expect } from "chai";
import { TrustManager, TrustToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TrustManager Contract", function () {
  let manager: TrustManager;
  let token: TrustToken;
  let owner: HardhatEthersSigner,
    alice: HardhatEthersSigner,
    bob: HardhatEthersSigner,
    charlie: HardhatEthersSigner;

  // Prima di ogni test, deploya i contratti da zero per un ambiente pulito
  beforeEach(async function () {
    [owner, alice, bob, charlie] = await ethers.getSigners();
    const TokenFactory = await ethers.getContractFactory("TrustToken");
    token = await TokenFactory.deploy();
    const ManagerFactory = await ethers.getContractFactory("TrustManager");
    manager = await ManagerFactory.deploy(await token.getAddress());
  });

  describe("Group Management", function () {
    it("Should allow a user to create a group", async function () {
      await expect(manager.connect(alice).createGroup([bob.address, charlie.address]))
        .to.emit(manager, "GroupCreated")
        .withArgs(0, alice.address, [alice.address, bob.address, charlie.address]);
      const members = await manager.getGroupMembers(0);
      expect(members.length).to.equal(3);
    });

    it("Should allow a user to join an existing group", async function () {
      await manager.connect(alice).createGroup([bob.address]);
      await expect(manager.connect(charlie).joinGroup(0))
        .to.emit(manager, "UserJoinedGroup")
        .withArgs(0, charlie.address);
      const members = await manager.getGroupMembers(0);
      expect(members.length).to.equal(3);
    });

    it("Should prevent a user from joining a group they are already in", async function () {
        await manager.connect(alice).createGroup([bob.address]);
        await expect(manager.connect(bob).joinGroup(0)).to.be.revertedWith("TrustManager: User is already a member.");
    });

    // NUOVO TEST: Verifica che un utente non possa unirsi a un gruppo che non esiste.
    it("Should revert when trying to join a non-existent group", async function () {
        await expect(manager.connect(alice).joinGroup(999)).to.be.revertedWith("TrustManager: Group does not exist.");
    });
  });

  describe("Expense Management", function () {
    beforeEach(async function () {
      await manager.connect(alice).createGroup([bob.address, charlie.address]);
    });
    
    it("Should add an expense with equal split", async function () {
        const amount = ethers.parseUnits("90", 18);
        await manager.connect(alice).addExpenseEqually(0, "Cena", amount, [alice.address, bob.address, charlie.address]);
        expect(await manager.balances(0, alice.address)).to.equal(ethers.parseUnits("60", 18));
        expect(await manager.balances(0, bob.address)).to.equal(ethers.parseUnits("-30", 18));
        expect(await manager.balances(0, charlie.address)).to.equal(ethers.parseUnits("-30", 18));
    });

    it("Should add an expense with percentage split", async function () {
        const amount = ethers.parseUnits("100", 18);
        await manager.connect(alice).addExpenseByPercentage(0, "Regalo", amount, [bob.address, charlie.address], [70, 30]);
        expect(await manager.balances(0, alice.address)).to.equal(amount);
        expect(await manager.balances(0, bob.address)).to.equal(ethers.parseUnits("-70", 18));
        expect(await manager.balances(0, charlie.address)).to.equal(ethers.parseUnits("-30", 18));
    });

    // NUOVO TEST: Verifica la funzione con importi esatti.
    it("Should add an expense with exact amounts", async function () {
        const amount = ethers.parseUnits("100", 18);
        // Alice paga 100, ma il debito è di 80 per Bob e 20 per Charlie.
        await manager.connect(alice).addExpenseWithExactAmounts(0, "Varie", amount, [bob.address, charlie.address], [ethers.parseUnits("80", 18), ethers.parseUnits("20", 18)]);
        expect(await manager.balances(0, alice.address)).to.equal(amount);
        expect(await manager.balances(0, bob.address)).to.equal(ethers.parseUnits("-80", 18));
        expect(await manager.balances(0, charlie.address)).to.equal(ethers.parseUnits("-20", 18));
    });

    it("Should revert if percentages do not sum to 100", async function () {
        const amount = ethers.parseUnits("100", 18);
        await expect(manager.connect(alice).addExpenseByPercentage(0, "Errore", amount, [bob.address], [99]))
            .to.be.revertedWith("Percentages must sum to 100");
    });

    // NUOVO TEST: Verifica che solo i membri possano aggiungere spese.
    it("Should revert if a non-member tries to add an expense", async function() {
        const amount = ethers.parseUnits("100", 18);
        // 'owner' non è membro del gruppo 0.
        await expect(manager.connect(owner).addExpenseEqually(0, "Intrusione", amount, [alice.address]))
            .to.be.revertedWith("Payer is not a member.");
    });
  });

  describe("Debt Simplification", function () {
    beforeEach(async function() {
        await manager.connect(alice).createGroup([bob.address, charlie.address]);
    });

    it("Should simplify a complex debt scenario correctly", async function () {
      await manager.connect(alice).addExpenseEqually(0, "Spesa 1", ethers.parseUnits("60", 18), [alice.address, bob.address, charlie.address]);
      await manager.connect(bob).addExpenseEqually(0, "Spesa 2", ethers.parseUnits("60", 18), [alice.address, bob.address, charlie.address]);
      await manager.connect(alice).simplifyDebts(0);
      expect(await manager.balances(0, alice.address)).to.equal(ethers.parseUnits("20", 18));
      expect(await manager.balances(0, bob.address)).to.equal(ethers.parseUnits("20", 18));
      expect(await manager.balances(0, charlie.address)).to.equal(ethers.parseUnits("-40", 18));
    });

    // NUOVO TEST: Verifica un debito circolare dove i saldi netti sono zero.
    it("Should correctly resolve a circular debt (A->B, B->C, C->A)", async function() {
        // A paga 50 per B. Debito: B deve 50 ad A. Saldi: A:+50, B:-50
        await manager.connect(alice).addExpenseWithExactAmounts(0, "Prestito A->B", 50, [bob.address], [50]);
        // B paga 50 per C. Debito: C deve 50 a B. Saldi: B:0, C:-50
        await manager.connect(bob).addExpenseWithExactAmounts(0, "Prestito B->C", 50, [charlie.address], [50]);
        // C paga 50 per A. Debito: A deve 50 a C. Saldi: C:0, A:0
        await manager.connect(charlie).addExpenseWithExactAmounts(0, "Prestito C->A", 50, [alice.address], [50]);

        // I saldi netti finali sono tutti zero
        expect(await manager.balances(0, alice.address)).to.equal(0);
        expect(await manager.balances(0, bob.address)).to.equal(0);
        expect(await manager.balances(0, charlie.address)).to.equal(0);

        // La semplificazione non dovrebbe fare nulla e non dovrebbe fallire
        await expect(manager.connect(alice).simplifyDebts(0)).to.not.be.reverted;

        // I saldi devono rimanere zero
        expect(await manager.balances(0, alice.address)).to.equal(0);
    });
    it("Should revert if a non-member tries to simplify debts", async function() {
      // 'owner' non è membro del gruppo 0, che è stato creato da Alice.
      await expect(manager.connect(owner).simplifyDebts(0))
        .to.be.revertedWith("TrustManager: Caller is not a member of the group.");
    });
  });

  describe("Debt Settlement", function () {
    beforeEach(async function () {
      await manager.connect(alice).createGroup([bob.address]);
      await manager.connect(alice).addExpenseEqually(0, "Biglietti", ethers.parseUnits("100", 18), [alice.address, bob.address]);
    });

    it("Should allow a debtor to settle their debt", async function () {
        const managerAddress = await manager.getAddress();
        const debtAmount = ethers.parseUnits("50", 18);
        await token.connect(bob).mint({value: ethers.parseEther("0.1")});
        await token.connect(bob).approve(managerAddress, debtAmount);
        await manager.connect(bob).settleDebt(0, alice.address);
        expect(await manager.balances(0, alice.address)).to.equal(0);
        expect(await token.balanceOf(alice.address)).to.equal(debtAmount);
    });

    it("Should revert if a user without debt tries to pay", async function(){
        await expect(manager.connect(alice).settleDebt(0, bob.address))
            .to.be.revertedWith("SettleDebt: You do not have a negative balance.");
    });
    
    it("Should revert if the token transfer fails (e.g., not enough allowance)", async function(){
        await token.connect(bob).mint({value: ethers.parseEther("0.1")});
        await expect(manager.connect(bob).settleDebt(0, alice.address))
            .to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    // NUOVO TEST: Verifica che non si possa pagare qualcuno che non è un creditore.
    it("Should revert when trying to pay a non-creditor", async function() {
        // Creiamo un secondo gruppo dove nessuno ha debiti
        await manager.connect(charlie).createGroup([]);
        const debtAmount = ethers.parseUnits("50", 18);
        await token.connect(bob).mint({value: ethers.parseEther("0.1")});
        await token.connect(bob).approve(await manager.getAddress(), debtAmount);
        
        // Bob (debitore nel gruppo 0) prova a pagare Charlie (non creditore nel gruppo 0)
        await expect(manager.connect(bob).settleDebt(0, charlie.address))
            .to.be.revertedWith("SettleDebt: The specified user is not a creditor.");
    });
  });
});