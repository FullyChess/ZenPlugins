export type CoinId = 'btc' | 'eth' | 'ltc' | 'matic' | 'doge'

export interface Preferences {
  coin: CoinId
  addresses: string
}

export interface CoinConfig {
  instrument: string
  // divisor to convert smallest unit (satoshi/wei/etc) to ZenMoney instrument unit
  divisor: number
  type: 'utxo' | 'account'
}

// UTXO-based transaction (BTC, LTC, DOGE)
export interface UtxoInput {
  input_index: number
  value: string
  address: string
}

export interface UtxoOutput {
  output_index: number
  value: string
  address: string
}

export interface UtxoBlock {
  hash: string
  height: number
  time: string
}

export interface UtxoTransaction {
  id: string
  hash: string
  received_at: string
  fees: string
  inputs: UtxoInput[]
  outputs: UtxoOutput[]
  block?: UtxoBlock
  confirmations: number
}

// Account-based transaction (ETH, MATIC)
export interface AccountTransaction {
  hash: string
  received_at: string
  value: string
  gas: string
  gas_price: string
  gas_used: string
  from: string
  to: string
  status: number
  confirmations: number
  block?: {
    hash: string
    height: number
    time: string
  }
}

export interface AddressBalance {
  address: string
  balance: string
}

export interface LedgerPage<T> {
  data: T[]
  token?: string
}
