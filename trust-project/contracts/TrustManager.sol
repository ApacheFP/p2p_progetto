// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "./TrustToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";

/**
 * @title TrustManager
 * @author Tuo Nome
 * @dev Contratto principale per la gestione di gruppi, spese e debiti nell'ecosistema TRUST.
 * Questo contratto funge da "backend" on-chain per l'applicazione, gestendo tutta la logica di business.
 * Si interfaccia con un token ERC20 (`TrustToken`) per la gestione dei saldi.
 */
contract TrustManager {

    // --- Variabili di Stato ---

    /// @dev Indirizzo del contratto TrustToken, che viene impostato una sola volta nel costruttore
    /// per garantire che il sistema si interfacci sempre con il token corretto. `immutable` ottimizza i costi di gas.
    address public immutable trustTokenAddress;

    // --- Strutture Dati ---
    
    struct Group {
        address owner;
        address[] members;
    }

    struct Expense {
        uint256 id;
        string description;
        uint256 totalAmount;
        address payer;
        uint256 groupId;
        uint256 timestamp;
    }

    // --- Modifiers ---

    /**
    * @dev Modifier per garantire che solo un membro di un gruppo specifico
    * possa chiamare una funzione.
    */
    modifier onlyMember(uint256 _groupId) {
        require(_isMemberOf(_groupId, msg.sender), "TrustManager: Caller is not a member of the group.");
        _; // Il simbolo '_' esegue il corpo della funzione a cui il modifier è applicato.
    }
    
    // --- Mappings ---

    uint256 private nextGroupId;
    mapping(uint256 => Group) public groups;
    mapping(address => uint256[]) public userGroups;

    uint256 private nextExpenseId;
    mapping(uint256 => Expense) public expenses;
    
    // =====================================================================================
    // !! SPIEGAZIONE DEL REFACTORING: DA GRAFO DEI DEBITI A SALDI NETTI !!
    //
    // ### PERCHÉ QUESTO REFACTORING È STATO NECESSARIO? ###
    // L'algoritmo di semplificazione (specificato nella traccia) richiede come primo passo il calcolo
    // del saldo netto di ogni membro del gruppo (totale dovuto - totale che si deve).
    //
    // ### COSA SAREBBE SUCCESSO SENZA QUESTO REFACTORING? (L'APPROCCIO SCARTATO) ###
    // Un primo approccio intuitivo sarebbe stato usare un grafo dei debiti, es:
    // `mapping(address => mapping(address => uint256)) public debts;` // (debts[debitore][creditore])
    //
    // Il problema: Per calcolare il saldo netto di un singolo utente 'U' con questo approccio,
    // la funzione `simplifyDebts` avrebbe dovuto eseguire calcoli molto complessi e costosi:
    // 1. Iterare su TUTTI gli altri membri 'M' del gruppo per sommare `debts[M][U]` (quanto è dovuto a 'U').
    // 2. Iterare di nuovo su TUTTI gli altri membri 'M' per sommare `debts[U][M]` (quanto 'U' deve).
    // Questa è un'operazione con complessità O(N^2) per l'intero gruppo (dove N è il numero di membri).
    // Sulla blockchain, dove ogni lettura da storage ha un costo, un'operazione del genere sarebbe diventata
    // **proibitivamente costosa in termini di gas**, rendendo la funzione `simplifyDebts`
    // praticamente inutilizzabile anche per gruppi di medie dimensioni.
    //
    // ### LA SOLUZIONE ADOTTATA ###
    // Abbiamo scelto di mantenere direttamente i saldi netti. Ogni volta che una spesa viene aggiunta,
    // aggiorniamo incrementalmente il saldo di ogni persona coinvolta.
    // Vantaggio: Quando `simplifyDebts` viene chiamata, il passo 1 dell'algoritmo non richiede calcoli,
    // ma una semplice e **ultra-efficiente lettura** (O(N)) dei saldi già pronti.
    // Questo refactoring è quindi una scelta architetturale critica per rendere l'algoritmo di
    // semplificazione fattibile ed economico on-chain.
    // =====================================================================================
    mapping(uint256 => mapping(address => int256)) public balances;

    // --- Eventi ---

    event GroupCreated(uint256 indexed groupId, address indexed creator, address[] members);
    event UserJoinedGroup(uint256 indexed groupId, address indexed user);
    event ExpenseAdded(
        uint256 indexed expenseId,
        uint256 indexed groupId,
        address indexed payer,
        uint256 totalAmount,
        string description
    );
    event DebtsSimplified(uint256 indexed groupId);
    event DebtSettled(uint256 indexed groupId, address indexed debtor, address indexed creditor, uint256 amount);

    
    /**
     * @dev Il costruttore imposta l'indirizzo del contratto del token ERC20.
     * @param _trustTokenAddress L'indirizzo del contratto TrustToken deployato.
     */
    constructor(address _trustTokenAddress) {
        trustTokenAddress = _trustTokenAddress;
    }

    // ===============================================
    // Funzioni di Gestione Gruppi
    // ===============================================

    /**
     * @notice Crea un nuovo gruppo con una lista iniziale di membri.
     * @dev Il chiamante della funzione (`msg.sender`) diventa il proprietario e primo membro.
     * @param _initialMembers Array di indirizzi dei membri da aggiungere inizialmente.
     */
    function createGroup(address[] calldata _initialMembers) external {
        uint256 groupId = nextGroupId;
        Group storage newGroup = groups[groupId];
        newGroup.owner = msg.sender;
        newGroup.members.push(msg.sender);
        userGroups[msg.sender].push(groupId);
        for (uint i = 0; i < _initialMembers.length; i++) {
            address member = _initialMembers[i];
            if (member != address(0) && !_isMemberOf(groupId, member)) {
                newGroup.members.push(member);
                userGroups[member].push(groupId);
            }
        }
        emit GroupCreated(groupId, msg.sender, newGroup.members);
        nextGroupId++;
    }

    /**
     * @notice Permette di unirsi a un gruppo esistente.
     * @dev Controlla che il gruppo esista e che l'utente non ne sia già membro.
     * @param _groupId L'ID del gruppo a cui unirsi.
     */
    function joinGroup(uint256 _groupId) external {
        require(groups[_groupId].owner != address(0), "TrustManager: Group does not exist.");
        bool isAlreadyMember = _isMemberOf(_groupId, msg.sender);
        require(!isAlreadyMember, "TrustManager: User is already a member.");
        groups[_groupId].members.push(msg.sender);
        userGroups[msg.sender].push(_groupId);
        emit UserJoinedGroup(_groupId, msg.sender);
    }
    
    // =============================================================
    // Funzioni Pubbliche per la Gestione delle Spese
    // =============================================================
    
    // Scelta implementativa: sono state create 3 funzioni distinte per aderire letteralmente
    // alla specifica. Un approccio alternativo e più ottimizzato (spesso usato nelle DApp reali)
    // sarebbe stato avere una sola funzione che accetta importi pre-calcolati off-chain,
    // per risparmiare gas e ridurre la complessità del contratto.

    /**
     * @notice Aggiunge una spesa dividendola equamente tra i partecipanti.
     * @dev Calcola on-chain la quota per ogni partecipante. Eventuali resti vengono assegnati al primo partecipante.
     * @param _groupId L'ID del gruppo in cui registrare la spesa.
     * @param _description Descrizione della spesa (es. "Cena").
     * @param _totalAmount L'importo totale della spesa.
     * @param _participants La lista dei membri che partecipano alla spesa.
     */
    function addExpenseEqually(
        uint256 _groupId,
        string calldata _description,
        uint256 _totalAmount,
        address[] calldata _participants
    ) external {
        require(_participants.length > 0, "Must have at least one participant");
        
        uint256 share = _totalAmount / _participants.length;
        uint256 remainder = _totalAmount % _participants.length;

        address[] memory debtors = new address[](_participants.length);
        uint256[] memory amounts = new uint256[](_participants.length);
        
        for (uint i = 0; i < _participants.length; i++) {
            debtors[i] = _participants[i];
            amounts[i] = share;
        }

        // Per evitare perdite di fondi dovute all'arrotondamento della divisione tra interi,
        // il resto viene assegnato al primo partecipante della lista.
        if (remainder > 0) {
            amounts[0] += remainder;
        }

        _addExpense(_groupId, _description, _totalAmount, msg.sender, debtors, amounts);
    }

    /**
     * @notice Aggiunge una spesa dividendola secondo percentuali specifiche.
     * @dev Calcola on-chain gli importi. Eventuali resti da arrotondamento vengono assegnati al primo partecipante.
     * @param _groupId L'ID del gruppo.
     * @param _description Descrizione della spesa.
     * @param _totalAmount L'importo totale della spesa.
     * @param _participants La lista dei membri che partecipano alla spesa.
     * @param _percentages Le rispettive percentuali di debito (devono sommare a 100).
     */
    function addExpenseByPercentage(
        uint256 _groupId,
        string calldata _description,
        uint256 _totalAmount,
        address[] calldata _participants,
        uint256[] calldata _percentages
    ) external {
        require(_participants.length > 0, "Must have at least one participant");
        require(_participants.length == _percentages.length, "Arrays must have same length");
        
        address[] memory debtors = new address[](_participants.length);
        uint256[] memory amounts = new uint256[](_participants.length);
        uint256 totalPercentage = 0;
        uint256 sumOfAmounts = 0;
        
        for (uint i = 0; i < _participants.length; i++) {
            totalPercentage += _percentages[i];
            // Il calcolo della percentuale viene fatto on-chain.
            uint256 amount = (_totalAmount * _percentages[i]) / 100;
            debtors[i] = _participants[i];
            amounts[i] = amount;
            sumOfAmounts += amount;
        }
        require(totalPercentage == 100, "Percentages must sum to 100");

        // Anche qui, gestiamo eventuali resti dovuti agli arrotondamenti per non perdere fondi.
        uint256 remainder = _totalAmount - sumOfAmounts;
        if (remainder > 0) {
            amounts[0] += remainder;
        }

        _addExpense(_groupId, _description, _totalAmount, msg.sender, debtors, amounts);
    }

    /**
     * @notice Aggiunge una spesa con importi esatti specificati per ogni debitore.
     * @param _groupId L'ID del gruppo.
     * @param _description Descrizione della spesa.
     * @param _totalAmount L'importo totale della spesa.
     * @param _debtors La lista degli indirizzi dei debitori.
     * @param _amounts La lista dei rispettivi importi dovuti.
     */
    function addExpenseWithExactAmounts(
        uint256 _groupId,
        string calldata _description,
        uint256 _totalAmount,
        address[] calldata _debtors,
        uint256[] calldata _amounts
    ) external {
        _addExpense(_groupId, _description, _totalAmount, msg.sender, _debtors, _amounts);
    }

    // =============================================================
    // Sezione Semplificazione dei Debiti
    // =============================================================

    /// @dev Struttura dati usata internamente per l'algoritmo di semplificazione.
    struct BalanceInfo {
        address user;
        int256 amount;
    }
    
    /**
     * @notice Ricalcola e semplifica i debiti per un gruppo usando un algoritmo greedy.
     * @dev Questa funzione implementa l'algoritmo descritto nella specifica del progetto.
     * 1. Partiziona i membri in debitori e creditori basandosi sui loro saldi netti.
     * 2. Ordina i due gruppi.
     * 3. Azzera i saldi del gruppo.
     * 4. Esegue un "greedy matching" per creare nuovi saldi netti che rappresentano il grafo dei debiti semplificato.
     * @param _groupId L'ID del gruppo i cui debiti devono essere semplificati.
     */
    function simplifyDebts(uint256 _groupId) external onlyMember(_groupId) {
        address[] memory members = groups[_groupId].members;
        require(members.length > 0, "Group has no members to simplify.");

        // Passo 1 & 2: Ottieni saldi (già pronti grazie al refactoring!) e partiziona
        BalanceInfo[] memory debtors = new BalanceInfo[](members.length);
        BalanceInfo[] memory creditors = new BalanceInfo[](members.length);
        uint debtorsCount = 0;
        uint creditorsCount = 0;

        for (uint i = 0; i < members.length; i++) {
            address member = members[i];
            int256 balance = balances[_groupId][member];
            if (balance < 0) {
                debtors[debtorsCount++] = BalanceInfo(member, balance);
            } else if (balance > 0) {
                creditors[creditorsCount++] = BalanceInfo(member, balance);
            }
        }
        
        _trimBalanceArray(debtors, debtorsCount);
        _trimBalanceArray(creditors, creditorsCount);
        
        // Passo 3: Ordinamento
        _sortBalances(debtors, true); 
        _sortBalances(creditors, false);

        // Inizio della creazione del nuovo "grafo": azzeriamo i saldi precedenti del gruppo.
        for(uint i = 0; i < members.length; i++){
            balances[_groupId][members[i]] = 0;
        }

        // Passo 4: Greedy Matching
        uint i_debtor = 0;
        uint i_creditor = 0;
        while (i_debtor < debtors.length && i_creditor < creditors.length) {
            uint256 transferAmount = min(abs(debtors[i_debtor].amount), uint256(creditors[i_creditor].amount));

            if (transferAmount > 0) {
                // Creiamo il nuovo "debito" semplificato aggiornando i saldi resettati.
                balances[_groupId][debtors[i_debtor].user] -= int256(transferAmount);
                balances[_groupId][creditors[i_creditor].user] += int256(transferAmount);
                
                // Aggiorniamo i saldi temporanei nell'array in memoria per far progredire il loop.
                debtors[i_debtor].amount += int256(transferAmount);
                creditors[i_creditor].amount -= int256(transferAmount);
            }

            // Se un saldo è stato azzerato, passiamo all'elemento successivo nell'array.
            if (debtors[i_debtor].amount == 0) {
                i_debtor++;
            }
            if (creditors[i_creditor].amount == 0) {
                i_creditor++;
            }
        }
        emit DebtsSimplified(_groupId);
    }
    
    // ===============================================
    // Funzioni Interne e Helper
    // ===============================================

    /**
     * @dev Funzione interna per registrare una spesa e aggiornare i saldi. È 'internal'
     * per evitare duplicazione di codice tra le tre funzioni di spesa pubbliche.
     */
    function _addExpense(
        uint256 _groupId,
        string calldata _description,
        uint256 _totalAmount,
        address _payer,
        address[] memory _debtors,
        uint256[] memory _amounts
    ) internal {
        require(groups[_groupId].owner != address(0), "Group does not exist.");
        require(_isMemberOf(_groupId, _payer), "Payer is not a member.");
        require(_debtors.length == _amounts.length, "Arrays length mismatch.");
        
        uint256 sumOfAmounts = 0;
        for (uint i = 0; i < _debtors.length; i++) {
            require(_isMemberOf(_groupId, _debtors[i]), "A debtor is not a member.");
            sumOfAmounts += _amounts[i];
        }
        require(sumOfAmounts == _totalAmount, "Sum of amounts must equal total.");
        
        uint256 expenseId = nextExpenseId;
        expenses[expenseId] = Expense({
            id: expenseId,
            description: _description,
            totalAmount: _totalAmount,
            payer: _payer,
            groupId: _groupId,
            timestamp: block.timestamp
        });

        balances[_groupId][_payer] += int256(_totalAmount);
        for (uint i = 0; i < _debtors.length; i++) {
            balances[_groupId][_debtors[i]] -= int256(_amounts[i]);
        }
        
        emit ExpenseAdded(expenseId, _groupId, _payer, _totalAmount, _description);
        nextExpenseId++;
    }

    /**
     * @dev Funzione helper interna per verificare l'appartenenza a un gruppo.
     */
    function _isMemberOf(uint256 _groupId, address _user) internal view returns (bool) {
        address[] storage members = groups[_groupId].members;
        for (uint i = 0; i < members.length; i++) {
            if (members[i] == _user) {
                return true;
            }
        }
        return false;
    }

    /**
     * @dev Ordina un array di BalanceInfo. Usa l'algoritmo Insertion Sort (O(N^2)).
     * Scelta implementativa: Insertion Sort è semplice da implementare in Solidity e sufficiente
     * per il contesto di questo progetto. Per DApp su larga scala con array molto grandi,
     * questo diventerebbe un collo di bottiglia per il gas e si dovrebbero esplorare
     * strutture dati o pattern più complessi (es. alberi binari, calcoli off-chain).
     */
    function _sortBalances(BalanceInfo[] memory arr, bool ascending) internal pure {
        for (uint i = 1; i < arr.length; i++) {
            BalanceInfo memory key = arr[i];
            int j = int(i) - 1;
            bool condition;
            if (ascending) { condition = j >= 0 && arr[uint(j)].amount > key.amount; } 
            else { condition = j >= 0 && arr[uint(j)].amount < key.amount; }
            while (condition) {
                arr[uint(j + 1)] = arr[uint(j)];
                j--;
                if(j < 0) break;
                if (ascending) { condition = j >= 0 && arr[uint(j)].amount > key.amount; } 
                else { condition = j >= 0 && arr[uint(j)].amount < key.amount; }
            }
            arr[uint(j + 1)] = key;
        }
    }

    /**
     * @dev Funzione helper per rimuovere gli elementi vuoti da un array di BalanceInfo.
     * Modifica la lunghezza dell'array in memoria tramite un blocco di assembly,
     * un'operazione a basso livello molto efficiente.
     */
    function _trimBalanceArray(BalanceInfo[] memory arr, uint newSize) internal pure {
        assembly { mstore(arr, newSize) }
    }

    /**
     * @dev Funzione helper per trovare il minimo tra due uint256.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
    
    /**
     * @dev Funzione helper per trovare il valore assoluto di un int256.
     */
    function abs(int256 n) internal pure returns (uint256) {
        return n >= 0 ? uint256(n) : uint256(-n);
    }


    // ===============================================
    // Sezione Saldo dei Debiti
    // ===============================================

    /**
     * @notice Permette a un utente (debitore) di saldare il suo debito verso un creditore in un gruppo.
     * @dev Questa funzione implementa il pattern 'approve' e 'transferFrom'. L'utente (`msg.sender`)
     * deve prima aver approvato il contratto TrustManager a spendere i suoi TrustToken.
     * La funzione trasferisce i token dal debitore al creditore e aggiorna i saldi netti.
     * @param _groupId L'ID del gruppo in cui si vuole saldare il debito.
     * @param _creditorAddress L'indirizzo del creditore che deve ricevere i fondi.
     */
    function settleDebt(uint256 _groupId, address _creditorAddress) external {
        address debtor = msg.sender;
        
        // --- CHECKS ---
        // Convalida tutte le condizioni prima di procedere.
        int256 debtorBalance = balances[_groupId][debtor];
        int256 creditorBalance = balances[_groupId][_creditorAddress];
        require(debtorBalance < 0, "SettleDebt: You do not have a negative balance.");
        require(creditorBalance > 0, "SettleDebt: The specified user is not a creditor.");
        
        // L'importo da saldare è il minimo tra il valore assoluto del debito e il credito.
        // Questo gestisce correttamente i casi in cui un debitore deve pagare più creditori o viceversa.
        uint256 amountToSettle = min(abs(debtorBalance), uint256(creditorBalance));
        require(amountToSettle > 0, "SettleDebt: No debt to settle between these users.");

        // --- EFFECTS ---
        // Aggiorniamo lo stato del NOSTRO contratto PRIMA di interagire con l'esterno.
        // Questo è il pattern "Checks-Effects-Interactions" e previene vulnerabilità di tipo re-entrancy.
        balances[_groupId][debtor] += int256(amountToSettle);
        balances[_groupId][_creditorAddress] -= int256(amountToSettle);

        // --- INTERACTIONS ---
        // Solo dopo aver aggiornato lo stato, chiamiamo il contratto esterno per il trasferimento dei token.
        // Se `transferFrom` fallisce per qualsiasi motivo (es. fondi insufficienti o mancata approvazione),
        // l'intera transazione (inclusi gli effetti sui saldi) viene annullata automaticamente.
        IERC20 token = IERC20(trustTokenAddress);
        bool success = token.transferFrom(debtor, _creditorAddress, amountToSettle);
        require(success, "SettleDebt: ERC20 transfer failed. Check allowance.");

        emit DebtSettled(_groupId, debtor, _creditorAddress, amountToSettle);
    }

    // ===============================================
    // Funzioni di Lettura (View)
    // ===============================================

    /**
     * @notice Restituisce la lista dei membri di un dato gruppo.
     * @param _groupId L'ID del gruppo da interrogare.
     * @return address[] La lista degli indirizzi dei membri.
     */
    function getGroupMembers(uint256 _groupId) external view returns (address[] memory) {
        return groups[_groupId].members;
    }

    /**
     * @notice Restituisce la lista degli ID dei gruppi a cui un utente appartiene.
     * @param _user L'indirizzo dell'utente da interrogare.
     * @return uint256[] La lista degli ID dei gruppi.
     */
    function getUserGroups(address _user) external view returns (uint256[] memory) {
        return userGroups[_user];
    }
}