/**
 * TON network via TonAPI (tonapi.io) — public, no API key required.
 * Accepts any TON address format: EQ..., UQ..., 0:...
 * Syncs native TON and all Jetton tokens.
 */
import { fetchJson } from '../../../common/network'
import { Account, AccountType, Transaction } from '../../../types/zenmoney'
import type { ScrapeResult } from '../types'

const API = 'https://tonapi.io/v2'
// 1 TON = 1e9 nanoton; 1 μTON = 1000 nanoton
const TON_DIVISOR = 1000
const TON_INSTRUMENT = 'μTON'
const PAGE_SIZE = 100

interface TonAccountInfo {
  balance: number // nanoton
  address: {
    bounceable: string
    non_bounceable: string
    raw: string
  }
}

interface TonTxMsg {
  source?: { address: string }
  destination?: { address: string }
  value: number // nanoton
}

interface TonTransaction {
  hash: string
  lt: number
  utime: number
  in_msg?: TonTxMsg
  out_msgs: TonTxMsg[]
  total_fees: { grams: number }
}

interface JettonTransfer {
  transaction_id: { hash: string, lt: number }
  timestamp: number
  sender?: { address: string }
  recipient?: { address: string }
  amount: string
  jetton: {
    address: string
    name: string
    symbol: string
    decimals: number
  }
}

interface TonTransactionsResponse {
  transactions: TonTransaction[]
}

interface JettonTransfersResponse {
  transfers: JettonTransfer[]
}

async function fetchTonAccount (address: string): Promise<TonAccountInfo> {
  const response = await fetchJson(`${API}/accounts/${encodeURIComponent(address)}`)
  if (response.status !== 200) throw new Error(`TonAPI error ${response.status}`)
  return response.body as TonAccountInfo
}

async function fetchTonTransactions (address: string, fromDate: Date): Promise<TonTransaction[]> {
  const results: TonTransaction[] = []
  const fromTs = Math.floor(fromDate.getTime() / 1000)
  let beforeLt: number | undefined

  do {
    const url = beforeLt !== undefined
      ? `${API}/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_SIZE}&before_lt=${beforeLt}`
      : `${API}/accounts/${encodeURIComponent(address)}/transactions?limit=${PAGE_SIZE}`
    const response = await fetchJson(url)
    if (response.status !== 200) break
    const page = (response.body as TonTransactionsResponse).transactions
    const fresh = page.filter(tx => tx.utime >= fromTs)
    results.push(...fresh)
    if (fresh.length < page.length) break // hit the date boundary
    const oldest = page.at(-1)
    beforeLt = oldest !== undefined ? oldest.lt : undefined
  } while (beforeLt !== undefined && results.length < 2000)

  return results
}

async function fetchJettonTransfers (address: string, fromDate: Date): Promise<JettonTransfer[]> {
  const results: JettonTransfer[] = []
  const fromTs = Math.floor(fromDate.getTime() / 1000)
  let beforeLt: number | undefined

  do {
    const url = beforeLt !== undefined
      ? `${API}/accounts/${encodeURIComponent(address)}/jettons/transfers?limit=${PAGE_SIZE}&before_lt=${beforeLt}`
      : `${API}/accounts/${encodeURIComponent(address)}/jettons/transfers?limit=${PAGE_SIZE}`
    const response = await fetchJson(url)
    if (response.status !== 200) break
    const page = (response.body as JettonTransfersResponse).transfers
    const fresh = page.filter(t => t.timestamp >= fromTs)
    results.push(...fresh)
    if (fresh.length < page.length) break
    const oldest = page.at(-1)
    beforeLt = oldest !== undefined ? oldest.transaction_id.lt : undefined
  } while (beforeLt !== undefined && results.length < 2000)

  return results
}

async function fetchJettonBalances (address: string): Promise<Map<string, { symbol: string, decimals: number, balance: string }>> {
  const response = await fetchJson(`${API}/accounts/${encodeURIComponent(address)}/jettons`)
  if (response.status !== 200) return new Map()
  const balances = (response.body as {
    balances: Array<{
      balance: string
      jetton: { address: string, symbol: string, decimals: number }
    }>
  }).balances

  const map = new Map<string, { symbol: string, decimals: number, balance: string }>()
  for (const b of balances) {
    map.set(b.jetton.address.toLowerCase(), {
      symbol: b.jetton.symbol,
      decimals: b.jetton.decimals,
      balance: b.balance
    })
  }
  return map
}

function tokenAmount (rawValue: string, decimals: number): number {
  return Math.round(Number(rawValue) / Math.pow(10, Math.max(0, decimals - 2))) / 100
}

export async function scrapeTon (address: string, fromDate: Date): Promise<ScrapeResult> {
  const [accountInfo, tonTxs, jettonTransfers, jettonBalances] = await Promise.all([
    fetchTonAccount(address),
    fetchTonTransactions(address, fromDate),
    fetchJettonTransfers(address, fromDate),
    fetchJettonBalances(address)
  ])

  const normalizedAddr = accountInfo.address.raw.toLowerCase()
  const displayAddr = accountInfo.address.bounceable

  const tonAccount: Account = {
    id: `ton:${normalizedAddr}`,
    type: AccountType.checking,
    title: `TON ${displayAddr.slice(0, 10)}…`,
    instrument: TON_INSTRUMENT,
    balance: Math.round(accountInfo.balance / TON_DIVISOR),
    syncIds: [`ton:${normalizedAddr}`]
  }

  // Native TON transactions
  const tonTransactions: Transaction[] = []
  for (const tx of tonTxs) {
    // Determine direction from in_msg / out_msgs
    const isIncoming = tx.in_msg?.source !== undefined && tx.in_msg.value > 0
    const isOutgoing = tx.out_msgs.length > 0 && tx.out_msgs[0].value > 0

    if (!isIncoming && !isOutgoing) continue

    if (isIncoming && tx.in_msg !== undefined) {
      const zenSum = Math.round(tx.in_msg.value / TON_DIVISOR)
      if (zenSum === 0) continue
      tonTransactions.push({
        hold: false,
        date: new Date(tx.utime * 1000),
        movements: [{
          id: tx.hash,
          account: { id: `ton:${normalizedAddr}` },
          invoice: null,
          sum: zenSum,
          fee: 0
        }],
        merchant: tx.in_msg.source !== undefined
          ? { fullTitle: tx.in_msg.source.address, mcc: null, location: null }
          : null,
        comment: null
      })
    } else if (isOutgoing) {
      const totalOut = tx.out_msgs.reduce((s, m) => s + m.value, 0)
      const zenSum = Math.round(totalOut / TON_DIVISOR)
      if (zenSum === 0) continue
      const fee = -Math.round(tx.total_fees.grams / TON_DIVISOR)
      tonTransactions.push({
        hold: false,
        date: new Date(tx.utime * 1000),
        movements: [{
          id: tx.hash,
          account: { id: `ton:${normalizedAddr}` },
          invoice: null,
          sum: -zenSum,
          fee
        }],
        merchant: tx.out_msgs[0].destination !== undefined
          ? { fullTitle: tx.out_msgs[0].destination.address, mcc: null, location: null }
          : null,
        comment: null
      })
    }
  }

  // Jetton accounts from current balances
  const jettonAccounts: Account[] = []
  for (const [contract, meta] of jettonBalances) {
    const accId = `ton:${normalizedAddr}:${contract}`
    jettonAccounts.push({
      id: accId,
      type: AccountType.checking,
      title: `${meta.symbol} (TON)`,
      instrument: meta.symbol,
      balance: tokenAmount(meta.balance, meta.decimals),
      syncIds: [accId]
    })
  }

  // Jetton transfer transactions
  const jettonTransactions: Transaction[] = []
  for (const transfer of jettonTransfers) {
    const contract = transfer.jetton.address.toLowerCase()
    const meta = jettonBalances.get(contract) ?? {
      symbol: transfer.jetton.symbol,
      decimals: transfer.jetton.decimals,
      balance: '0'
    }
    const zenSum = tokenAmount(transfer.amount, meta.decimals)
    if (zenSum === 0) continue

    const senderAddr = transfer.sender?.address?.toLowerCase() ?? ''
    const isSender = senderAddr === normalizedAddr
    const accId = `ton:${normalizedAddr}:${contract}`

    // ensure account exists even for tokens no longer held
    if (!jettonBalances.has(contract)) {
      jettonBalances.set(contract, meta)
      const existingAcc = jettonAccounts.find(a => a.id === accId)
      if (existingAcc === undefined) {
        jettonAccounts.push({
          id: accId,
          type: AccountType.checking,
          title: `${meta.symbol} (TON)`,
          instrument: meta.symbol,
          balance: 0,
          syncIds: [accId]
        })
      }
    }

    jettonTransactions.push({
      hold: false,
      date: new Date(transfer.timestamp * 1000),
      movements: [{
        id: transfer.transaction_id.hash,
        account: { id: accId },
        invoice: null,
        sum: isSender ? -zenSum : zenSum,
        fee: 0
      }],
      merchant: {
        fullTitle: isSender
          ? (transfer.recipient?.address ?? '')
          : (transfer.sender?.address ?? ''),
        mcc: null,
        location: null
      },
      comment: null
    })
  }

  return {
    accounts: [tonAccount, ...jettonAccounts],
    transactions: [...tonTransactions, ...jettonTransactions]
  }
}
