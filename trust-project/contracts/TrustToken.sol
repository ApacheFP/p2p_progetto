// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TrustToken
 * @dev Un semplice token ERC-20 con una funzione di mint pubblica e a pagamento.
 */
contract TrustToken is ERC20 {

    // Tasso di cambio fisso: 1 Ether = 1000 TRUST tokens
    // Usiamo 1000 * 10**18 perché i token ERC20, come Ether, hanno 18 decimali.
    uint256 public constant RATE = 1000;

    /**
     * @dev Il costruttore imposta il nome e il simbolo del token.
     */
    constructor() ERC20("Trust Token", "TRUST") {}

    /**
     * @dev Permette a chiunque di coniare nuovi token inviando Ether al contratto.
     * La funzione è 'payable', il che significa che può ricevere Ether.
     */
    function mint() external payable {
        // 'msg.value' è la quantità di Ether (in Wei) inviata con la transazione.
        require(msg.value > 0, "TrustToken: must send ETH to mint tokens");

        // Calcoliamo quanti token coniare in base all'Ether inviato e al tasso di cambio.
        uint256 amountToMint = msg.value * RATE;

        // La funzione _mint è fornita dal contratto ERC20 di OpenZeppelin.
        // Conia i nuovi token e li assegna all'indirizzo del chiamante (msg.sender).
        _mint(msg.sender, amountToMint);
    }
}