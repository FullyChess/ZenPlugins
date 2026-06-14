import { LedgerCsvRow } from './types'

// Parses a single CSV line respecting quoted fields
function parseCsvLine (line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

const KNOWN_TYPES = new Set<string>(['IN', 'OUT', 'FEES'])

function parseRow (headers: string[], values: string[]): LedgerCsvRow | null {
  const col = (name: string): string => {
    const idx = headers.indexOf(name)
    return idx >= 0 ? (values[idx] ?? '').trim() : ''
  }

  const type = col('Operation Type')
  if (!KNOWN_TYPES.has(type)) return null

  const ticker = col('Currency Ticker')
  if (ticker === '') return null

  return {
    date: col('Operation Date'),
    ticker,
    type: type as LedgerCsvRow['type'],
    amount: parseFloat(col('Operation Amount')) || 0,
    txHash: col('Transaction Hash'),
    sender: col('Sender'),
    receiver: col('Receiver')
  }
}

export function parseLedgerCsv (text: string): LedgerCsvRow[] {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)

  if (lines.length < 2) return []

  const headers = parseCsvLine(lines[0])

  return lines
    .slice(1)
    .map(line => parseRow(headers, parseCsvLine(line)))
    .filter((row): row is LedgerCsvRow => row !== null)
}
