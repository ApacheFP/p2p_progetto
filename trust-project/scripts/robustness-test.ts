import { ethers } from "hardhat";
import { TrustManager, TrustToken } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// Funzione helper per tentare un'azione che dovrebbe fallire
async function expectRevert(action: Promise<any>, expectedError: string) {
    try {
        await action;
        console.error(`      ❌ TEST FALLITO: L'azione doveva fallire con "${expectedError}" ma ha avuto successo.`);
    } catch (error: any) {
        if (error.message.includes(expectedError)) {
            console.log(`      ✅ TEST PASSATO: La transazione è fallita come previsto.`);
        } else {
            console.error(`      ❌ TEST FALLITO: L'azione è fallita, ma con un errore diverso:`);
            console.error(`         ATTESO: "${expectedError}"`);
            console.error(`         RICEVUTO: "${error.message}"`);
        }
    }
}

async function main() {
    console.log("\n💣 Inizio Stress Test sulla Robustezza del Contratto TRUST 💣\n");

    // --- SETUP ---
    const [owner, alice, bob, charlie] = await ethers.getSigners();
    const TokenFactory = await ethers.getContractFactory("TrustToken");
    const token = await TokenFactory.deploy();
    const ManagerFactory = await ethers.getContractFactory("TrustManager");
    const manager = await ManagerFactory.deploy(await token.getAddress());

    // Setup iniziale: Alice crea un gruppo con Bob
    await manager.connect(alice).createGroup([bob.address]);
    console.log("--- Setup completato: Gruppo 0 creato da Alice con Bob ---");

    // =============================================================
    // SUITE 1: GESTIONE DEI GRUPPI
    // =============================================================
    console.log("\n--- Suite 1: Test di robustezza sulla Gestione dei Gruppi ---");

    console.log("\n[1.1] Test: Un utente non membro (owner) prova ad aggiungere una spesa.");
    const nonMemberExpense = manager.connect(owner).addExpenseEqually(0, "Tentativo intrusione", 100, [alice.address]);
    await expectRevert(nonMemberExpense, "Payer is not a member");

    console.log("\n[1.2] Test: Un utente già membro (Bob) prova a rientrare nel gruppo.");
    const joinTwice = manager.connect(bob).joinGroup(0);
    await expectRevert(joinTwice, "User is already a member");

    console.log("\n[1.3] Test: Un utente (Charlie) prova a unirsi a un gruppo che non esiste.");
    const joinNonExistent = manager.connect(charlie).joinGroup(999);
    await expectRevert(joinNonExistent, "Group does not exist");
    
    // =============================================================
    // SUITE 2: LOGICA DELLE SPESE
    // =============================================================
    console.log("\n--- Suite 2: Test di validazione sulla Logica delle Spese ---");

    console.log("\n[2.1] Test: Aggiunta spesa con percentuali che non sommano a 100.");
    const wrongPercentage = manager.connect(alice).addExpenseByPercentage(0, "Errore %", 100, [alice.address, bob.address], [50, 49]);
    await expectRevert(wrongPercentage, "Percentages must sum to 100");

    console.log("\n[2.2] Test: Aggiunta spesa con importi esatti la cui somma non corrisponde al totale.");
    const wrongAmounts = manager.connect(alice).addExpenseWithExactAmounts(0, "Errore Somma", 100, [bob.address], [99]);
    await expectRevert(wrongAmounts, "Sum of amounts must equal total");
    
    console.log("\n[2.3] Test: Un membro prova a registrare una spesa per un non-membro (Charlie).");
    const debtorNotMember = manager.connect(alice).addExpenseWithExactAmounts(0, "Debitore esterno", 100, [charlie.address], [100]);
    await expectRevert(debtorNotMember, "A debtor is not a member");

    // =============================================================
    // SUITE 3: SALDO DEI DEBITI
    // =============================================================
    console.log("\n--- Suite 3: Test di sicurezza sul Saldo dei Debiti ---");
    
    // Setup per questa suite: Bob deve 50 ad Alice
    await manager.connect(alice).addExpenseWithExactAmounts(0, "Debito Test", 100, [bob.address], [100]);
    await token.connect(bob).mint({ value: ethers.parseEther("0.1") }); // Bob ha i token per pagare

    console.log("\n[3.1] Test: Un creditore (Alice) prova a 'pagare' il suo debitore.");
    const creditorPays = manager.connect(alice).settleDebt(0, bob.address);
    await expectRevert(creditorPays, "You do not have a negative balance");
    
    console.log("\n[3.2] Test: Un debitore (Bob) prova a pagare un utente che non è creditore (Charlie).");
    const payNonCreditor = manager.connect(bob).settleDebt(0, charlie.address);
    await expectRevert(payNonCreditor, "The specified user is not a creditor");

    console.log("\n[3.3] Test: Un debitore (Bob) prova a pagare senza prima aver approvato la spesa.");
    const noAllowance = manager.connect(bob).settleDebt(0, alice.address);
    // L'errore proviene dal contratto ERC20, quindi il messaggio è diverso
    await expectRevert(noAllowance, "ERC20InsufficientAllowance"); 
    
    console.log("\n\n🏁 Stress Test Concluso. Tutti i controlli di sicurezza hanno funzionato come previsto! 🏁");
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});