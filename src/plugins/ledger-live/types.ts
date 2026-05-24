// Account returned by Ledger Live wallet-api (account.list)
export interface RawLedgerAccount {
  id: string
  name: string
  address: string
  currency: string        // e.g. "bitcoin", "ethereum", "solana"
  balance: string         // amount in smallest unit (satoshis, wei, lamports, ...)
  spendableBalance: string
  blockHeight?: number
  lastSyncDate: string    // ISO 8601 date
  parentAccountId?: string // set for ERC-20 tokens and sub-accounts
}

// Input/output entry in a UTXO transaction (Bitcoin-like chains)
export interface LedgerTxInput {
  input_index?: number
  value: string           // in smallest unit
  address: string
}

export interface LedgerTxOutput {
  output_index?: number
  value: string           // in smallest unit
  address: string
}

// Transaction returned by Ledger Explorer HTTP API
export interface LedgerExplorerTx {
  id: string
  hash: string
  received_at: string     // ISO 8601 date (confirmation time)
  fees: string            // in smallest unit
  inputs: LedgerTxInput[]
  outputs: LedgerTxOutput[]
  block?: {
    hash: string
    height: number
    time: string
  } | null
  confirmations: number
}

export interface LedgerExplorerResponse {
  truncated: boolean
  txs: LedgerExplorerTx[]
}
