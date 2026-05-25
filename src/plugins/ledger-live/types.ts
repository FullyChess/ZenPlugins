export interface LedgerCsvRow {
  date: string             // "Operation Date" — ISO 8601
  ticker: string           // "Currency Ticker" — BTC, ETH, SOL, ...
  type: 'IN' | 'OUT' | 'FEES'
  amount: number           // signed: positive for IN, negative for OUT/FEES
  txHash: string           // "Transaction Hash"
  sender: string
  receiver: string
}
