/**
 * EVM chains (Ethereum + Polygon) via Etherscan v2 API.
 * One Etherscan API key covers both networks.
 * Auto-discovers ALL ERC-20 tokens from transaction history — no manual token list needed.
 */
import { fetchJson } from '../../../common/network'
import { Account, AccountType, Transaction } from '../../../types/zenmoney'
import type { ScrapeResult } from '../types'

const ETHERSCAN = 'https://api.etherscan.io/v2/api'
const ETH_CHAIN = 1
const MATIC_CHAIN = 137

// Native coin config per chainId
const NATIVE: Record<number, { instrument: string, divisor: number, title: string }> = {
  [ETH_CHAIN]: { instrument: 'μETH', divisor: 1e12, title: 'ETH' },
  [MATIC_CHAIN]: { instrument: 'μMATIC', divisor: 1e12, title: 'Polygon (MATIC)' }
}

interface EtherscanResult<T> {
  status: string
  message: string
  result: T
}

interface NativeTx {
  hash: string
  timeStamp: string
  from: string
  to: string
  value: string
  gasPrice: string
  gasUsed: string
  isError: string
  confirmations: string
  blockNumber: string
}

interface TokenTx {
  hash: string
  timeStamp: string
  from: string
  to: string
  value: string
  contractAddress: string
  tokenName: string
  tokenSymbol: string
  tokenDecimal: string
  gasPrice: string
  gasUsed: string
  blockNumber: string
  confirmations: string
}

async function etherscanFetch<T> (params: Record<string, string | number>): Promise<T> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&')
  const response = await fetchJson(`${ETHERSCAN}?${qs}`)
  const body = response.body as EtherscanResult<T>
  if (body.status !== '1' && body.message !== 'No transactions found') {
    throw new Error(`Etherscan error: ${body.message ?? JSON.stringify(body)}`)
  }
  return body.result
}

async function fetchBlockByDate (chainId: number, date: Date, apiKey: string): Promise<number> {
  const ts = Math.floor(date.getTime() / 1000)
  const block = await etherscanFetch<string>({
    chainid: chainId,
    module: 'block',
    action: 'getblocknobytime',
    timestamp: ts,
    closest: 'before',
    apikey: apiKey
  })
  return parseInt(block)
}

async function fetchNativeBalance (chainId: number, address: string, apiKey: string): Promise<string> {
  return await etherscanFetch<string>({
    chainid: chainId,
    module: 'account',
    action: 'balance',
    address,
    tag: 'latest',
    apikey: apiKey
  })
}

async function fetchNativeTxs (chainId: number, address: string, startBlock: number, apiKey: string): Promise<NativeTx[]> {
  const result = await etherscanFetch<NativeTx[] | string>({
    chainid: chainId,
    module: 'account',
    action: 'txlist',
    address,
    startblock: startBlock,
    endblock: 'latest',
    sort: 'desc',
    offset: 1000,
    page: 1,
    apikey: apiKey
  })
  return Array.isArray(result) ? result : []
}

async function fetchTokenTxs (chainId: number, address: string, startBlock: number, apiKey: string): Promise<TokenTx[]> {
  const result = await etherscanFetch<TokenTx[] | string>({
    chainid: chainId,
    module: 'account',
    action: 'tokentx',
    address,
    startblock: startBlock,
    endblock: 'latest',
    sort: 'desc',
    offset: 1000,
    page: 1,
    apikey: apiKey
  })
  return Array.isArray(result) ? result : []
}

async function fetchTokenBalance (chainId: number, contract: string, address: string, apiKey: string): Promise<string> {
  return await etherscanFetch<string>({
    chainid: chainId,
    module: 'account',
    action: 'tokenbalance',
    contractaddress: contract,
    address,
    tag: 'latest',
    apikey: apiKey
  })
}

function nativeAccountId (chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`
}

function tokenAccountId (chainId: number, address: string, contract: string): string {
  return `${chainId}:${address.toLowerCase()}:${contract.toLowerCase()}`
}

function tokenAmount (rawValue: string, decimals: number): number {
  return Math.round(Number(rawValue) / Math.pow(10, Math.max(0, decimals - 2))) / 100
}

async function scrapeChain (chainId: number, address: string, fromDate: Date, apiKey: string): Promise<ScrapeResult> {
  const cfg = NATIVE[chainId]
  const addr = address.toLowerCase()
  const startBlock = await fetchBlockByDate(chainId, fromDate, apiKey)

  const [rawBalance, nativeTxs, tokenTxs] = await Promise.all([
    fetchNativeBalance(chainId, address, apiKey),
    fetchNativeTxs(chainId, address, startBlock, apiKey),
    fetchTokenTxs(chainId, address, startBlock, apiKey)
  ])

  const nativeId = nativeAccountId(chainId, address)
  const nativeAccount: Account = {
    id: nativeId,
    type: AccountType.checking,
    title: `${cfg.title} ${address.slice(0, 8)}…`,
    instrument: cfg.instrument,
    balance: Math.round(Number(rawBalance) / cfg.divisor),
    syncIds: [nativeId]
  }

  // Native coin transactions (value > 0, no error)
  const nativeTxnMap = new Map<string, Transaction>()
  for (const tx of nativeTxs) {
    if (tx.isError === '1') continue
    const value = Number(tx.value)
    if (value === 0) continue
    const isSender = tx.from.toLowerCase() === addr
    const zenSum = Math.round(value / cfg.divisor)
    if (zenSum === 0) continue
    const fee = isSender
      ? -Math.round((Number(tx.gasPrice) * Number(tx.gasUsed)) / cfg.divisor)
      : 0

    nativeTxnMap.set(tx.hash, {
      hold: tx.confirmations === '0',
      date: new Date(Number(tx.timeStamp) * 1000),
      movements: [{
        id: tx.hash,
        account: { id: nativeId },
        invoice: null,
        sum: isSender ? -zenSum : zenSum,
        fee
      }],
      merchant: {
        fullTitle: isSender ? tx.to : tx.from,
        mcc: null,
        location: null
      },
      comment: null
    })
  }

  // Discover all ERC-20 token contracts from transfer history
  const contracts = new Map<string, { symbol: string, decimals: number }>()
  for (const tx of tokenTxs) {
    const contract = tx.contractAddress.toLowerCase()
    if (!contracts.has(contract)) {
      contracts.set(contract, {
        symbol: tx.tokenSymbol,
        decimals: parseInt(tx.tokenDecimal)
      })
    }
  }

  // Fetch current balance for each discovered token
  const tokenAccounts: Account[] = []
  for (const [contract, meta] of contracts) {
    const rawBal = await fetchTokenBalance(chainId, contract, address, apiKey)
    const bal = tokenAmount(rawBal, meta.decimals)
    if (bal === 0 && !tokenTxs.some(t => t.contractAddress.toLowerCase() === contract)) continue
    const accId = tokenAccountId(chainId, address, contract)
    tokenAccounts.push({
      id: accId,
      type: AccountType.checking,
      title: `${meta.symbol} (${cfg.title})`,
      instrument: meta.symbol,
      balance: bal,
      syncIds: [accId]
    })
  }

  // Token transactions
  const tokenTxnMap = new Map<string, Transaction>()
  for (const tx of tokenTxs) {
    const contract = tx.contractAddress.toLowerCase()
    const meta = contracts.get(contract)
    if (meta === undefined) continue
    const isSender = tx.from.toLowerCase() === addr
    const zenSum = tokenAmount(tx.value, meta.decimals)
    if (zenSum === 0) continue
    const accId = tokenAccountId(chainId, address, contract)
    const key = `${tx.hash}:${contract}`
    tokenTxnMap.set(key, {
      hold: tx.confirmations === '0',
      date: new Date(Number(tx.timeStamp) * 1000),
      movements: [{
        id: tx.hash,
        account: { id: accId },
        invoice: null,
        sum: isSender ? -zenSum : zenSum,
        fee: 0 // gas fee is captured in native coin movements
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
    accounts: [nativeAccount, ...tokenAccounts],
    transactions: [...nativeTxnMap.values(), ...tokenTxnMap.values()]
  }
}

export async function scrapeEvm (
  ethAddress: string | undefined,
  maticAddress: string | undefined,
  apiKey: string,
  fromDate: Date
): Promise<ScrapeResult> {
  const results = await Promise.all([
    ethAddress !== undefined && ethAddress !== ''
      ? scrapeChain(ETH_CHAIN, ethAddress, fromDate, apiKey)
      : Promise.resolve<ScrapeResult>({ accounts: [], transactions: [] }),
    maticAddress !== undefined && maticAddress !== ''
      ? scrapeChain(MATIC_CHAIN, maticAddress, fromDate, apiKey)
      : Promise.resolve<ScrapeResult>({ accounts: [], transactions: [] })
  ])

  return {
    accounts: results.flatMap(r => r.accounts),
    transactions: results.flatMap(r => r.transactions)
  }
}
