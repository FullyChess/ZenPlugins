import { fetchJson } from '../../common/network'
import { LedgerExplorerResponse, LedgerExplorerTx, RawLedgerAccount } from './types'

export interface Preferences {
  port?: string  // Ledger Live WebSocket port, default "1248"
}

// Currencies supported by Ledger Explorer HTTP API.
// Key: Ledger Live currency id, Value: explorer path segment.
const EXPLORER_CURRENCIES: Record<string, string> = {
  bitcoin: 'bitcoin',
  bitcoin_cash: 'bitcoin_cash',
  bitcoin_gold: 'bitcoin_gold',
  litecoin: 'litecoin',
  dogecoin: 'dogecoin',
  dash: 'dash',
  zcash: 'zcash',
  ethereum: 'ethereum',
  ethereum_classic: 'ethereum_classic'
}

// Decimal places per currency (to convert smallest unit → full unit).
const CURRENCY_DECIMALS: Record<string, number> = {
  bitcoin: 8,
  bitcoin_cash: 8,
  bitcoin_gold: 8,
  litecoin: 8,
  dogecoin: 8,
  dash: 8,
  zcash: 8,
  ethereum: 18,
  ethereum_classic: 18,
  solana: 9,
  polkadot: 10,
  ripple: 6,
  stellar: 7,
  tron: 6,
  cosmos: 6
}

export function getDecimals (currency: string): number {
  return CURRENCY_DECIMALS[currency] ?? 8
}

export function isExplorerSupported (currency: string): boolean {
  return currency in EXPLORER_CURRENCIES
}

// ─── Ledger Live WebSocket / JSON-RPC ────────────────────────────────────────

declare let WebSocket: new (url: string) => {
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onerror: ((event: unknown) => void) | null
  onclose: ((event: { wasClean: boolean }) => void) | null
  send: (data: string) => void
  close: () => void
}

async function rpcCall (port: number, method: string, params: object = {}): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    const id = String(Date.now())
    let settled = false

    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      ws.close()
      fn()
    }

    const timer = setTimeout(() => {
      done(() => reject(new Error(
        `Timeout: Ledger Live не отвечает на localhost:${port}. Убедитесь, что Ledger Live запущен.`
      )))
    }, 15000)

    ws.onopen = () => {
      clearTimeout(timer)
      ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    }

    ws.onmessage = (event) => {
      let msg: { id: string, result?: unknown, error?: { message: string } }
      try {
        msg = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (msg.id !== id) return
      if (msg.error != null) {
        done(() => reject(new Error(`Ledger Live error: ${msg.error?.message ?? 'unknown'}`)))
      } else {
        done(() => resolve(msg.result))
      }
    }

    ws.onerror = () => {
      clearTimeout(timer)
      done(() => reject(new Error(
        `Не удалось подключиться к Ledger Live на localhost:${port}. Убедитесь, что Ledger Live запущен.`
      )))
    }

    ws.onclose = (event) => {
      if (!event.wasClean && !settled) {
        clearTimeout(timer)
        done(() => reject(new Error('WebSocket соединение с Ledger Live неожиданно закрылось.')))
      }
    }
  })
}

export async function getAccounts (port: number): Promise<RawLedgerAccount[]> {
  const result = await rpcCall(port, 'account.list', {}) as { rawAccounts: RawLedgerAccount[] }
  // Skip sub-accounts (ERC-20 tokens) — they have a parentAccountId set
  return result.rawAccounts.filter(a => a.parentAccountId == null)
}

// ─── Ledger Explorer HTTP API ─────────────────────────────────────────────────

const EXPLORER_BASE = 'https://explorers.api.live.ledger.com'
const PAGE_LIMIT = 100

export async function getOperations (
  currency: string,
  address: string,
  fromDate: Date,
  cursor?: string
): Promise<LedgerExplorerTx[]> {
  const explorerCurrency = EXPLORER_CURRENCIES[currency]
  if (explorerCurrency == null) return []

  const url = `${EXPLORER_BASE}/blockchain/v4/${explorerCurrency}/addresses/${address}/transactions` +
    `?noToken=true&limit=${PAGE_LIMIT}${cursor != null ? `&cursor=${cursor}` : ''}`

  const response = await fetchJson(url)
  const data = response.body as LedgerExplorerResponse
  const txs = data.txs ?? []

  // Filter out transactions that are older than fromDate
  const recent = txs.filter(tx => new Date(tx.received_at) >= fromDate)

  // If the page was full and all results are recent, fetch the next page
  if (data.truncated && recent.length === txs.length && txs.length > 0) {
    const lastTxId = txs[txs.length - 1].id
    return [...recent, ...await getOperations(currency, address, fromDate, lastTxId)]
  }

  return recent
}
