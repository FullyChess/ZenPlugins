/**
 * Bitcoin HD wallet sync via BlockCypher API.
 * Accepts xpub/zpub/ypub — one key covers all derived addresses.
 * User finds it in Ledger Live → Accounts → Edit → Advanced → Extended public key.
 */
import { fetchJson } from '../../../common/network'
import { Account, AccountType, Transaction } from '../../../types/zenmoney'
import type { ScrapeResult } from '../types'

const API = 'https://api.blockcypher.com/v1/btc/main'
// 1 BTC = 1e8 satoshi; 1 μBTC = 100 satoshi
const DIVISOR = 100
const INSTRUMENT = 'μBTC'

interface TxRef {
  tx_hash: string
  block_height: number
  tx_input_n: number // -1 = received (output to us), >=0 = spent (input from us)
  tx_output_n: number
  value: number // satoshi
  confirmed?: string // ISO date
  received?: string // ISO date (unconfirmed)
  spent: boolean
  confirmations: number
}

interface XpubResponse {
  address: string
  final_balance: number // satoshi
  txrefs?: TxRef[]
  unconfirmed_txrefs?: TxRef[]
  hasMore?: boolean
}

async function fetchPage (xpub: string, before?: number): Promise<XpubResponse> {
  const url = before !== undefined
    ? `${API}/addrs/${xpub}?limit=200&before=${before}`
    : `${API}/addrs/${xpub}?limit=200`
  const response = await fetchJson(url)
  if (response.status !== 200) throw new Error(`BlockCypher error: ${response.status}`)
  return response.body as XpubResponse
}

export async function scrapeBitcoin (xpub: string, fromDate: Date): Promise<ScrapeResult> {
  const allRefs: TxRef[] = []
  let before: number | undefined
  let hasMore = true
  let finalBalance = 0

  while (hasMore) {
    const page = await fetchPage(xpub, before)
    finalBalance = page.final_balance

    const refs = [...(page.txrefs ?? []), ...(page.unconfirmed_txrefs ?? [])]
    allRefs.push(...refs)

    hasMore = page.hasMore === true && refs.length > 0
    const oldest = refs.at(-1)
    if (oldest !== undefined) {
      const date = new Date(oldest.confirmed ?? oldest.received ?? 0)
      if (date < fromDate) break
      before = oldest.block_height
    } else {
      hasMore = false
    }
  }

  const account: Account = {
    id: xpub,
    type: AccountType.checking,
    title: `BTC (xpub …${xpub.slice(-8)})`,
    instrument: INSTRUMENT,
    balance: Math.round(finalBalance / DIVISOR),
    syncIds: [xpub]
  }

  // Group txrefs by tx_hash to compute per-transaction net change
  const byHash = new Map<string, TxRef[]>()
  for (const ref of allRefs) {
    const existing = byHash.get(ref.tx_hash) ?? []
    existing.push(ref)
    byHash.set(ref.tx_hash, existing)
  }

  const transactions: Transaction[] = []
  for (const [hash, refs] of byHash) {
    const first = refs[0]
    const txDate = new Date(first.confirmed ?? first.received ?? 0)
    if (txDate < fromDate) continue

    // tx_input_n == -1 means this is an output received by us
    // tx_input_n >= 0 means this is an input spent by us
    const received = refs.filter(r => r.tx_input_n === -1).reduce((s, r) => s + r.value, 0)
    const spent = refs.filter(r => r.tx_input_n >= 0).reduce((s, r) => s + r.value, 0)
    const net = received - spent
    const zenSum = Math.round(net / DIVISOR)
    if (zenSum === 0) continue

    transactions.push({
      hold: first.confirmations === 0,
      date: txDate,
      movements: [{
        id: hash,
        account: { id: xpub },
        invoice: null,
        sum: zenSum,
        fee: 0 // fee is included in the net (spent - received - fee = payment)
      }],
      merchant: null,
      comment: null
    })
  }

  return { accounts: [account], transactions }
}
