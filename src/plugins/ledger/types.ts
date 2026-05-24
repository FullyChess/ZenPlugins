export interface Preferences {
  // Bitcoin — extended public key (xpub/zpub/ypub from Ledger Live → Edit Account → Advanced)
  btcXpub?: string
  // Ethereum address — covers ETH + all ERC-20 tokens automatically
  ethAddress?: string
  // Polygon address — usually the same as ethAddress; covers MATIC + USDC and other tokens
  maticAddress?: string
  // Etherscan v2 API key — free at etherscan.io, covers both ETH and Polygon
  etherscanApiKey?: string
  // TRON address — covers TRX + USDT-TRC20 and all TRC-20 tokens
  tronAddress?: string
  // TON address — covers TON + all Jettons
  tonAddress?: string
  // Solana address(es) — comma-separated; covers SOL + all SPL tokens
  solanaAddresses?: string
}

export interface ScrapeResult {
  accounts: Array<import('../../types/zenmoney').Account>
  transactions: Array<import('../../types/zenmoney').Transaction>
}
