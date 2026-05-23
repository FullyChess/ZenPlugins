import type { CoinConfig, CoinId } from './types'

export const BASE_URL = 'https://explorers.api.live.ledger.com/blockchain/v4'

// μ-unit = 10^-6 of base unit
// divisor converts smallest on-chain unit to ZenMoney instrument unit
export const COIN_CONFIG: Record<CoinId, CoinConfig> = {
  btc: {
    instrument: 'μBTC',
    divisor: 100, // 1 BTC = 1e8 sat; 1 μBTC = 100 sat
    type: 'utxo'
  },
  ltc: {
    instrument: 'μLTC',
    divisor: 100, // 1 LTC = 1e8 litoshi; 1 μLTC = 100 litoshi
    type: 'utxo'
  },
  doge: {
    instrument: 'DOGE',
    divisor: 1e8, // 1 DOGE = 1e8 koinu; store in full DOGE with 2 decimals
    type: 'utxo'
  },
  eth: {
    instrument: 'μETH',
    divisor: 1e12, // 1 ETH = 1e18 wei; 1 μETH = 1e12 wei
    type: 'account'
  },
  matic: {
    instrument: 'μMATIC',
    divisor: 1e12, // 1 MATIC = 1e18 wei; 1 μMATIC = 1e12 wei
    type: 'account'
  }
}
