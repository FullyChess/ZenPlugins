import { Account, AccountType, Movement, Transaction } from '../../types/zenmoney'
import { LedgerCsvRow } from './types'

// One ZenMoney account per currency ticker found in the CSV.
// Balance = sum of all amounts (IN positive, OUT/FEES negative).
export function buildAccounts (rows: LedgerCsvRow[]): Account[] {
  const balances = new Map<string, number>()

  for (const row of rows) {
    balances.set(row.ticker, (balances.get(row.ticker) ?? 0) + row.amount)
  }

  return Array.from(balances.entries()).map(([ticker, raw]) => {
    // Round away floating-point noise (8 significant decimal places is enough for crypto)
    const balance = Math.round(raw * 1e8) / 1e8

    return {
      id: `ledger-${ticker}`,
      type: AccountType.checking,
      title: `Ledger ${ticker}`,
      instrument: ticker,
      syncIds: [`ledger-${ticker}`],
      balance
    } satisfies Account
  })
}

// Group rows by (ticker, txHash) to merge FEES into the parent OUT operation.
interface TxGroup {
  main: LedgerCsvRow
  fees: number  // absolute fee value
}

function groupRows (rows: LedgerCsvRow[]): Map<string, TxGroup> {
  const groups = new Map<string, TxGroup>()

  for (const row of rows) {
    // Rows with no hash can't be deduplicated — use a synthetic unique key
    const key = row.txHash !== ''
      ? `${row.ticker}-${row.txHash}`
      : `${row.ticker}-${row.date}-${row.amount}`

    const existing = groups.get(key)

    if (row.type === 'FEES') {
      if (existing != null) {
        groups.set(key, { ...existing, fees: existing.fees + Math.abs(row.amount) })
      } else {
        groups.set(key, { main: row, fees: Math.abs(row.amount) })
      }
    } else {
      if (existing != null) {
        groups.set(key, { ...existing, main: row })
      } else {
        groups.set(key, { main: row, fees: 0 })
      }
    }
  }

  return groups
}

function buildMovement (group: TxGroup): Movement {
  return {
    id: group.main.txHash !== '' ? group.main.txHash : null,
    account: { id: `ledger-${group.main.ticker}` },
    invoice: null,
    sum: group.main.amount,
    fee: group.fees
  }
}

export function buildTransactions (rows: LedgerCsvRow[]): Transaction[] {
  const groups = groupRows(rows)

  return Array.from(groups.values())
    .filter(g => g.main.type !== 'FEES')
    .map(group => {
      const movement = buildMovement(group)
      return {
        hold: false,
        date: new Date(group.main.date),
        movements: [movement] as [Movement],
        merchant: group.main.txHash !== ''
          ? { fullTitle: group.main.txHash, mcc: null, location: null }
          : null,
        comment: null
      } satisfies Transaction
    })
}
