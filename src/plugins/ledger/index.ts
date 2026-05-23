import type { ScrapeFunc } from '../../types/zenmoney'
import { fetchBalance, fetchUtxoTransactions, fetchAccountTransactions } from './api'
import { COIN_CONFIG } from './config'
import {
  convertAccount,
  convertUtxoTransaction,
  convertAccountTransaction,
  mergeTransferTransactions
} from './converters'
import type { Preferences } from './types'

export const scrape: ScrapeFunc<Preferences> = async ({ preferences, fromDate }) => {
  const addresses = preferences.addresses.split(',').map(a => a.trim()).filter(Boolean)
  const coin = preferences.coin
  const config = COIN_CONFIG[coin]

  const accounts = await Promise.all(
    addresses.map(async address => {
      const { balance } = await fetchBalance(coin, address)
      return convertAccount(address, balance, config)
    })
  )

  const allTransactions = (await Promise.all(
    addresses.map(async address => {
      if (config.type === 'utxo') {
        const txs = await fetchUtxoTransactions(coin, address, fromDate)
        return txs.flatMap(tx => {
          const converted = convertUtxoTransaction(address, tx, config)
          return converted !== null ? [converted] : []
        })
      } else {
        const txs = await fetchAccountTransactions(coin, address, fromDate)
        return txs.flatMap(tx => {
          const converted = convertAccountTransaction(address, tx, config)
          return converted !== null ? [converted] : []
        })
      }
    })
  )).flat()

  return {
    accounts,
    transactions: mergeTransferTransactions(allTransactions)
  }
}
