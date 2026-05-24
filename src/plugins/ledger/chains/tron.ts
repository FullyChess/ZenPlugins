/**
 * TRON network via TronGrid public API (no API key required).
 * Syncs native TRX and all TRC-20 tokens (including USDT-TRC20).
 */
import { fetchJson } from '../../../common/network'
import { Account, AccountType, Transaction } from '../../../types/zenmoney'
import type { ScrapeResult } from '../types'

const API = 'https://api.trongrid.io'
// 1 TRX = 1,000,000 sun → instrument μTRX (1 μTRX = 1 sun)
const TRX_INSTRUMENT = 'μTRX'
const PAGE_SIZE = 200

interface TronAccount {
  address: string
  balance?: number // sun
  trc20?: Array<Record<string, string>> // [{contractAddress: rawBalance}]
}

interface TronTx {
  txID: string
  block_timestamp: number
  ret?: Array<{ contractRet: string }>
  raw_data: {
    contract: Array<{
      type: string
      parameter: {
        value: {
          amount?: number
          owner_address: string
          to_address?: string
        }
      }
    }>
  }
}

interface Trc20Tx {
  transaction_id: string
  block_timestamp: number
  token_info: {
    address: string
    name: string
    symbol: string
    decimals: number
  }
  from: string
  to: string
  value: string
  type: string
}

interface TronPagedResponse<T> {
  data: T[]
  meta?: { fingerprint?: string }
}

async function fetchTronAccount (address: string): Promise<TronAccount | null> {
  const response = await fetchJson(`${API}/v1/accounts/${address}`)
  if (response.status !== 200) return null
  const data = (response.body as { data: TronAccount[] }).data
  return data[0] ?? null
}

async function fetchTrxTransactions (address: string, fromDate: Date): Promise<TronTx[]> {
  const results: TronTx[] = []
  const minTs = fromDate.getTime()
  let fingerprint: string | undefined

  do {
    const url = fingerprint !== undefined
      ? `${API}/v1/accounts/${address}/transactions?limit=${PAGE_SIZE}&min_timestamp=${minTs}&fingerprint=${fingerprint}`
      : `${API}/v1/accounts/${address}/transactions?limit=${PAGE_SIZE}&min_timestamp=${minTs}`
    const response = await fetchJson(url)
    if (response.status !== 200) break
    const page = response.body as TronPagedResponse<TronTx>
    results.push(...page.data)
    fingerprint = page.meta?.fingerprint
  } while (fingerprint !== undefined && results.length < 2000)

  return results
}

async function fetchTrc20Transactions (address: string, fromDate: Date): Promise<Trc20Tx[]> {
  const results: Trc20Tx[] = []
  const minTs = fromDate.getTime()
  let fingerprint: string | undefined

  do {
    const url = fingerprint !== undefined
      ? `${API}/v1/accounts/${address}/transactions/trc20?limit=${PAGE_SIZE}&min_timestamp=${minTs}&fingerprint=${fingerprint}`
      : `${API}/v1/accounts/${address}/transactions/trc20?limit=${PAGE_SIZE}&min_timestamp=${minTs}`
    const response = await fetchJson(url)
    if (response.status !== 200) break
    const page = response.body as TronPagedResponse<Trc20Tx>
    results.push(...page.data)
    fingerprint = page.meta?.fingerprint
  } while (fingerprint !== undefined && results.length < 2000)

  return results
}

function tokenAmount (rawValue: string, decimals: number): number {
  return Math.round(Number(rawValue) / Math.pow(10, Math.max(0, decimals - 2))) / 100
}

function base58ToHex (addr: string): string {
  // TronGrid returns hex addresses; user provides base58 (T...)
  // For comparison, convert both to lowercase string comparison
  return addr.toLowerCase()
}

export async function scrapeTron (address: string, fromDate: Date): Promise<ScrapeResult> {
  const addr = address.toLowerCase()
  const [accountData, trxTxs, trc20Txs] = await Promise.all([
    fetchTronAccount(address),
    fetchTrxTransactions(address, fromDate),
    fetchTrc20Transactions(address, fromDate)
  ])

  const trxBalance = accountData?.balance ?? 0
  const trxAccount: Account = {
    id: `trx:${addr}`,
    type: AccountType.checking,
    title: `TRX ${address.slice(0, 8)}…`,
    instrument: TRX_INSTRUMENT,
    balance: trxBalance, // sun = μTRX, no conversion needed
    syncIds: [`trx:${addr}`]
  }

  // TRX transfer transactions
  const trxTransactions: Transaction[] = []
  for (const tx of trxTxs) {
    if (tx.ret?.[0]?.contractRet !== 'SUCCESS') continue
    const contract = tx.raw_data.contract[0]
    if (contract?.type !== 'TransferContract') continue
    const val = contract.parameter.value
    if (val.amount === undefined || val.amount === 0) continue
    const isSender = base58ToHex(val.owner_address) === addr ||
      val.owner_address.toLowerCase() === addr
    const toAddr = val.to_address ?? ''
    trxTransactions.push({
      hold: false,
      date: new Date(tx.block_timestamp),
      movements: [{
        id: tx.txID,
        account: { id: `trx:${addr}` },
        invoice: null,
        sum: isSender ? -val.amount : val.amount,
        fee: 0
      }],
      merchant: {
        fullTitle: isSender ? toAddr : val.owner_address,
        mcc: null,
        location: null
      },
      comment: null
    })
  }

  // Discover TRC-20 tokens from transaction history
  const tokens = new Map<string, { symbol: string, decimals: number, balance: string }>()
  for (const tx of trc20Txs) {
    const contract = tx.token_info.address.toLowerCase()
    if (!tokens.has(contract)) {
      // find balance from accountData.trc20
      const rawBal = accountData?.trc20
        ?.find(t => Object.keys(t)[0].toLowerCase() === contract)
        ?.[Object.keys(accountData.trc20?.find(t => Object.keys(t)[0].toLowerCase() === contract) ?? {})[0]] ?? '0'
      tokens.set(contract, {
        symbol: tx.token_info.symbol,
        decimals: tx.token_info.decimals,
        balance: rawBal
      })
    }
  }

  // Token accounts
  const tokenAccounts: Account[] = []
  for (const [contract, meta] of tokens) {
    const accId = `trx:${addr}:${contract}`
    tokenAccounts.push({
      id: accId,
      type: AccountType.checking,
      title: `${meta.symbol} (TRON)`,
      instrument: meta.symbol,
      balance: tokenAmount(meta.balance, meta.decimals),
      syncIds: [accId]
    })
  }

  // TRC-20 transactions
  const trc20Transactions: Transaction[] = []
  for (const tx of trc20Txs) {
    const contract = tx.token_info.address.toLowerCase()
    const meta = tokens.get(contract)
    if (meta === undefined) continue
    const isSender = tx.from.toLowerCase() === addr
    const zenSum = tokenAmount(tx.value, meta.decimals)
    if (zenSum === 0) continue
    const accId = `trx:${addr}:${contract}`
    trc20Transactions.push({
      hold: false,
      date: new Date(tx.block_timestamp),
      movements: [{
        id: tx.transaction_id,
        account: { id: accId },
        invoice: null,
        sum: isSender ? -zenSum : zenSum,
        fee: 0
      }],
      merchant: {
        fullTitle: isSender ? tx.to : tx.from,
        mcc: null,
        location: null
      },
      comment: null
    })
  }

  return {
    accounts: [trxAccount, ...tokenAccounts],
    transactions: [...trxTransactions, ...trc20Transactions]
  }
}
