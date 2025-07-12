import { ethers } from "hardhat";
import { expect } from "chai";
import { TrustManager, TrustToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// =================================================================
// FUNZIONI HELPER PER LEGGIBILITÀ E MODULARITÀ
// =================================================================

/**
 * Funzione helper per deployare i contratti e restituire le loro istanze.
 */
async function deployContracts(): Promise<{ trustToken: TrustToken, trustManager: TrustManager }> {
    const TokenFactory = await ethers.getContractFactory("TrustToken");
    const trustToken = await TokenFactory.deploy() as TrustToken;
    
    const ManagerFactory = await ethers.getContractFactory("TrustManager");
    const trustManager = await ManagerFactory.deploy(await trustToken.getAddress()) as TrustManager;

    console.log(`\nTrustToken deployato a: ${await trustToken.getAddress()}`);
    console.log(`TrustManager deployato a: ${await trustManager.getAddress()}\n`);
    return { trustToken, trustManager };
}

/**
 * Funzione helper per visualizzare i saldi degli utenti in una tabella.
 */
async function logBalances(
    title: string,
    manager: TrustManager,
    users: { name: string, signer: HardhatEthersSigner }[]
) {
    console.log(`\n--- ${title} ---`);
    const balanceData = await Promise.all(users.map(async (user) => {
        const balance = await manager.balances(0, user.signer.address);
        // Usa ethers.formatUnits per una visualizzazione leggibile (es. "25.0")
        return {
            Utente: user.name,
            "Saldo Netto": ethers.formatUnits(balance, 18)
        };
    }));
    console.table(balanceData);
}

// =================================================================
// SCRIPT PRINCIPALE DELLA DEMO
// =================================================================

async function main() {
    console.log("🚀 Inizio Demo Finale del Progetto TRUST 🚀\n");

    // --- FASE 0: SETUP ---
    console.log("--- Fase 0: Setup Ambiente ---");
    const [owner, alice, bob, charlie, david] = await ethers.getSigners();
    const users = [
        { name: "Alice", signer: alice },
        { name: "Bob", signer: bob },
        { name: "Charlie", signer: charlie },
        { name: "David", signer: david }
    ];
    const { trustToken, trustManager } = await deployContracts();
    const managerAddress = await trustManager.getAddress();
    console.log("====================================================\n");

    // --- FASE 1: CREAZIONE GRUPPO E SPESE ---
    console.log("--- Fase 1: Creazione Gruppo e Aggiunta Spese Complesse ---\n");
    await (await trustManager.connect(alice).createGroup([bob.address, charlie.address, david.address])).wait();
    console.log("Gruppo 0 creato da Alice con Bob, Charlie e David.\n");

    // Usiamo ethers.parseUnits per creare le spese con la scala corretta a 18 decimali
    await (await trustManager.connect(alice).addExpenseEqually(0, "Affitto", ethers.parseUnits("100", 18), [alice.address, bob.address, charlie.address, david.address])).wait();
    console.log("✅ Spesa 1 (Equa): Alice paga 100 token.");

    await (await trustManager.connect(bob).addExpenseByPercentage(0, "Bollette", ethers.parseUnits("80", 18), [charlie.address, david.address], [60, 40])).wait();
    console.log("✅ Spesa 2 (Percentuale): Bob paga 80 token.");

    await (await trustManager.connect(charlie).addExpenseWithExactAmounts(0, "Spesa", ethers.parseUnits("50", 18), [alice.address], [ethers.parseUnits("50", 18)])).wait();
    console.log("✅ Spesa 3 (Esatta): Charlie paga 50 token.");

    await (await trustManager.connect(david).addExpenseWithExactAmounts(0, "Caffè", ethers.parseUnits("20", 18), [bob.address], [ethers.parseUnits("20", 18)])).wait();
    console.log("✅ Spesa 4 (Circolare): David paga 20 token.");
    console.log("====================================================\n");

    // --- FASE 2: ANALISI SALDI E SEMPLIFICAZIONE ---
    await logBalances("Saldi Netti Aggregati (Pre-Semplificazione)", trustManager, users);

    console.log("\n--- Fase 3: Semplificazione dei Debiti ---\n");
    await (await trustManager.connect(alice).simplifyDebts(0)).wait(); //capogruppo
    console.log("✅ Semplificazione Debiti: Alice (capogruppo) ha avviato la semplificazione dei debiti del gruppo 0.");
    console.log("✅ Debiti Semplificati! Il grafo dei debiti ora è ottimale.");
    await logBalances("Saldi Netti (Post-Semplificazione)", trustManager, users);
    console.log("====================================================\n");

    // --- FASE 4: SALDO DEBITI ---
    console.log("\n--- Fase 4: Saldo Debiti Multiplo ---\n");
    await (await trustToken.connect(charlie).mint({ value: ethers.parseEther("0.03") })).wait();
    await (await trustToken.connect(david).mint({ value: ethers.parseEther("0.04") })).wait();
    console.log("Debitori (Charlie e David) hanno ricevuto i token per pagare.\n");

    const debtCharlie = ethers.parseUnits("23", 18);
    await (await trustToken.connect(charlie).approve(managerAddress, debtCharlie)).wait();
    await (await trustManager.connect(charlie).settleDebt(0, bob.address)).wait();
    console.log(`✅ Charlie ha saldato il suo debito di 23 token con Bob.`);
    
    const debtToBob = ethers.parseUnits("12", 18);
    await (await trustToken.connect(david).approve(managerAddress, debtToBob)).wait();
    await (await trustManager.connect(david).settleDebt(0, bob.address)).wait();
    console.log(`✅ David ha saldato il suo debito di 12 token con Bob.`);
    
    const debtToAlice = ethers.parseUnits("25", 18);
    await (await trustToken.connect(david).approve(managerAddress, debtToAlice)).wait();
    await (await trustManager.connect(david).settleDebt(0, alice.address)).wait();
    console.log(`✅ David ha saldato il suo debito di 25 token con Alice.`);
    console.log("====================================================\n");

    // --- FASE 5: VERIFICA FINALE ---
    await logBalances("Saldi Finali nel TrustManager (Tutti a Zero)", trustManager, users);

    console.log("\n--- Stato Finale dei Token ERC20 ---\n");
    const tokenBalances = await Promise.all(users.map(async (user) => {
        const balance = await trustToken.balanceOf(user.signer.address);
        return { 
            Utente: user.name, 
            "Token Posseduti": ethers.formatUnits(balance, 18)
        };
    }));
    console.table(tokenBalances);
    console.log("====================================================\n");
    
    // --- FASE 6: TEST DI FALLIMENTO CONTROLLATO ---
    console.log("--- Fase 6: Test di Fallimento Controllato ---\n");
    console.log("Alice prova a pagare Bob, ma non ha un saldo negativo. La transazione deve fallire.");
    await expect(trustManager.connect(alice).settleDebt(0, bob.address))
        .to.be.revertedWith("SettleDebt: You do not have a negative balance.");
    console.log("✅ Transazione fallita come previsto!");
    console.log("====================================================\n");

    console.log("🏁 Demo Conclusa con Successo! 🏁");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});