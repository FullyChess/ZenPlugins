import { ScrapeFunc } from '../../types/zenmoney'
import { getAccounts, getOperations, isExplorerSupported, Preferences } from './api'
import { convertAccounts, convertTransactions } from './converters'

export const scrape: ScrapeFunc<Preferences> = async ({ fromDate, preferences }) => {
  const port = parseInt(preferences.port ?? '1248', 10)

  const rawAccounts = await getAccounts(port)
  const accounts = convertAccounts(rawAccounts)

  const transactions = (
    await Promise.all(
      rawAccounts.map(async (raw) => {
        if (!isExplorerSupported(raw.currency)) return []
        const txs = await getOperations(raw.currency, raw.address, fromDate)
        return convertTransactions(txs, raw)
      })
    )
  ).flat()

  return { accounts, transactions }
}
