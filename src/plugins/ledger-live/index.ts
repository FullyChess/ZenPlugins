import { ScrapeFunc } from '../../types/zenmoney'
import { Preferences } from './api'
import { parseLedgerCsv } from './csvParser'
import { buildAccounts, buildTransactions } from './converters'

// FileReader is a DOM global — declare it for TypeScript (no dom lib in tsconfig)
declare class FileReader {
  result: string | ArrayBuffer | null
  onload: (() => void) | null
  onerror: (() => void) | null
  readAsText (blob: Blob, encoding?: string): void
}

async function readBlob (blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Не удалось прочитать CSV файл'))
    reader.readAsText(blob, 'utf-8')
  })
}

export const scrape: ScrapeFunc<Preferences> = async ({ fromDate }) => {
  const files = await ZenMoney.pickDocuments(['text/csv', 'text/plain', '*/*'], false)
  if (files.length === 0) {
    throw new Error('Файл не выбран. Выберите CSV-файл, экспортированный из Ledger Wallet.')
  }

  const text = await readBlob(files[0])
  const allRows = parseLedgerCsv(text)

  if (allRows.length === 0) {
    throw new Error('CSV-файл пустой или имеет неизвестный формат. Убедитесь, что вы экспортировали файл из Ledger Wallet.')
  }

  // Balances are computed from ALL rows (full CSV history)
  const accounts = buildAccounts(allRows)

  // Transactions are filtered by the ZenMoney sync start date
  const recentRows = allRows.filter(r => new Date(r.date) >= fromDate)
  const transactions = buildTransactions(recentRows)

  return { accounts, transactions }
}
