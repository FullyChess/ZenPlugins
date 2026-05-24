import type { ScrapeFunc } from '../../types/zenmoney'
import type { Preferences } from './types'
import { scrapeBitcoin } from './chains/bitcoin'
import { scrapeEvm } from './chains/evm'
import { scrapeTron } from './chains/tron'
import { scrapeTon } from './chains/ton'
import { scrapeSolana } from './chains/solana'

export const scrape: ScrapeFunc<Preferences> = async ({ preferences, fromDate }) => {
  const tasks: Array<Promise<{ accounts: Array<import('../../types/zenmoney').Account>, transactions: Array<import('../../types/zenmoney').Transaction> }>> = []

  if (preferences.btcXpub !== undefined && preferences.btcXpub !== '') {
    tasks.push(scrapeBitcoin(preferences.btcXpub, fromDate))
  }

  if ((preferences.ethAddress !== undefined && preferences.ethAddress !== '') ||
      (preferences.maticAddress !== undefined && preferences.maticAddress !== '')) {
    const apiKey = preferences.etherscanApiKey ?? ''
    if (apiKey === '') {
      throw new Error('Etherscan API Key обязателен для синхронизации ETH и Polygon')
    }
    tasks.push(scrapeEvm(preferences.ethAddress, preferences.maticAddress, apiKey, fromDate))
  }

  if (preferences.tronAddress !== undefined && preferences.tronAddress !== '') {
    tasks.push(scrapeTron(preferences.tronAddress, fromDate))
  }

  if (preferences.tonAddress !== undefined && preferences.tonAddress !== '') {
    tasks.push(scrapeTon(preferences.tonAddress, fromDate))
  }

  if (preferences.solanaAddresses !== undefined && preferences.solanaAddresses !== '') {
    tasks.push(scrapeSolana(preferences.solanaAddresses, fromDate))
  }

  const results = await Promise.all(tasks)

  return {
    accounts: results.flatMap(r => r.accounts),
    transactions: results.flatMap(r => r.transactions)
  }
}
