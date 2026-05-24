/**
 * Solana via public RPC + Jupiter token list for metadata.
 * Shows ALL SPL token accounts — no hardcoded token list.
 * Jupiter strict list is cached for 24h to avoid re-fetching on every sync.
 */
import { fetchJson } from '../../../common/network'
import { Account, AccountType, Movement, Transaction } from '../../../types/zenmoney'
import type { ScrapeResult } from '../types'

const RPC = 'https://api.mainnet-beta.solana.com'
const JUPITER_LIST = 'https://token.jup.ag/strict'
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
// 1 SOL = 1e9 lamports; 1 μSOL = 1000 lamports
const SOL_DIVISOR = 1000
const SOL_INSTRUMENT = 'μSOL'
const JUPITER_CACHE_KEY = 'jupiterTokenList'
const JUPITER_CACHE_TS_KEY = 'jupiterTokenListTs'
const JUPITER_TTL_MS = 24 * 60 * 60 * 1000

interface JupiterToken {
  address: string
  symbol: string
  decimals: number
}

interface TokenMeta {
  symbol: string
  decimals: number
}

async function getJupiterTokenList (): Promise<Map<string, TokenMeta>> {
  const cached = ZenMoney.getData(JUPITER_CACHE_KEY) as JupiterToken[] | undefined
  const cachedTs = ZenMoney.getData(JUPITER_CACHE_TS_KEY) as number | undefined
  if (cached !== undefined && cachedTs !== undefined && Date.now() - cachedTs < JUPITER_TTL_MS) {
    return new Map(cached.map(t => [t.address, { symbol: t.symbol, decimals: t.decimals }]))
  }

  const response = await fetchJson(JUPITER_LIST)
  if (response.status === 200) {
    const tokens = response.body as JupiterToken[]
    ZenMoney.setData(JUPITER_CACHE_KEY, tokens)
    ZenMoney.setData(JUPITER_CACHE_TS_KEY, Date.now())
    ZenMoney.saveData()
    return new Map(tokens.map(t => [t.address, { symbol: t.symbol, decimals: t.decimals }]))
  }
  return new Map(cached?.map(t => [t.address, { symbol: t.symbol, decimals: t.decimals }]) ?? [])
}

async function rpc<T> (method: string, params: unknown[]): Promise<T> {
  const response = await fetchJson(RPC, {
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method, params }
  })
  if (response.status !== 200) throw new Error(`Solana RPC error: ${response.status}`)
  const body = response.body as { result?: T, error?: { message: string } }
  if (body.error !== undefined) throw new Error(`Solana RPC: ${body.error.message}`)
  return body.result as T
}

async function fetchBalance (address: string): Promise<number> {
  const result = await rpc<{ value: number }>('getBalance', [address])
  return result.value
}

interface TokenAccountInfo {
  pubkey: string
  mint: string
  amount: number
  decimals: number
}

async function fetchAllTokenAccounts (owner: string): Promise<TokenAccountInfo[]> {
  const result = await rpc<{
    value: Array<{
      pubkey: string
      account: { data: { parsed: { info: { mint: string, tokenAmount: { amount: string, decimals: number } } } } }
    }>
  }>('getTokenAccountsByOwner', [owner, { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' }])

  return result.value.map(r => ({
    pubkey: r.pubkey,
    mint: r.account.data.parsed.info.mint,
    amount: parseInt(r.account.data.parsed.info.tokenAmount.amount),
    decimals: r.account.data.parsed.info.tokenAmount.decimals
  }))
}

interface Signature {
  signature: string
  blockTime: number | null
}

async function fetchSignatures (address: string, fromDate: Date, lastSig?: string): Promise<Signature[]> {
  const allSigs: Signature[] = []
  const fromTs = Math.floor(fromDate.getTime() / 1000)
  let before: string | undefined

  do {
    const params: [string, object] = [address, { limit: 50, until: lastSig, before }]
    const sigs = await rpc<Signature[]>('getSignaturesForAddress', params)
    const fresh = sigs.filter(s => (s.blockTime ?? 0) >= fromTs)
    allSigs.push(...fresh)
    if (fresh.length < sigs.length || sigs.length === 0) break
    before = sigs.at(-1)?.signature
  } while (allSigs.length < 1000)

  return allSigs
}

interface SolTransaction {
  blockTime: number
  meta: {
    postBalances: number[]
    preBalances: number[]
    fee: number
    postTokenBalances: Array<{ accountIndex: number, mint: string, uiTokenAmount: { amount: string, decimals: number } }>
    preTokenBalances: Array<{ accountIndex: number, mint: string, uiTokenAmount: { amount: string, decimals: number } }>
  }
  transaction: {
    message: { accountKeys: Array<{ pubkey: string, signer: boolean }> }
    signatures: string[]
  }
}

async function fetchTransaction (signature: string): Promise<SolTransaction | null> {
  const result = await rpc<SolTransaction | null>('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }])
  return result
}

function tokenAmountFromRaw (amount: number, decimals: number): number {
  return Math.round(amount / Math.pow(10, Math.max(0, decimals - 2))) / 100
}

export async function scrapeSolana (addressesStr: string, fromDate: Date): Promise<ScrapeResult> {
  const addresses = addressesStr.split(',').map(a => a.trim()).filter(Boolean)
  const jupiterMap = await getJupiterTokenList()

  const allAccounts: Account[] = []
  const allTransactions: Transaction[] = []

  for (const address of addresses) {
    const [lamports, tokenAccountInfos] = await Promise.all([
      fetchBalance(address),
      fetchAllTokenAccounts(address)
    ])

    // Native SOL account
    const solAccId = `sol:${address}`
    allAccounts.push({
      id: solAccId,
      type: AccountType.checking,
      title: `SOL ${address.slice(0, 8)}…`,
      instrument: SOL_INSTRUMENT,
      balance: Math.round(lamports / SOL_DIVISOR),
      syncIds: [solAccId]
    })

    // SPL token accounts (all with any amount, plus those with recent txns)
    const tokenAccMap = new Map<string, Account>()
    for (const ta of tokenAccountInfos) {
      const meta = jupiterMap.get(ta.mint) ?? { symbol: `SPL_${ta.mint.slice(0, 8)}`, decimals: ta.decimals }
      const accId = `sol:${address}:${ta.mint}`
      const account: Account = {
        id: accId,
        type: AccountType.checking,
        title: `${meta.symbol} (Solana)`,
        instrument: meta.symbol,
        balance: tokenAmountFromRaw(ta.amount, meta.decimals),
        syncIds: [accId]
      }
      tokenAccMap.set(ta.pubkey, account)
      allAccounts.push(account)
    }

    // Fetch transaction signatures
    const lastSig = ZenMoney.getData(`sol_lastSig_${address}`) as string | undefined
    const signatures = await fetchSignatures(address, fromDate, lastSig)
    if (signatures.length > 0 && signatures[0].signature !== undefined) {
      ZenMoney.setData(`sol_lastSig_${address}`, signatures[0].signature)
    }

    // Parse transactions
    for (const sig of signatures) {
      const tx = await fetchTransaction(sig.signature)
      if (tx === null) continue

      const accountKeys = tx.transaction.message.accountKeys
      const myIndex = accountKeys.findIndex(k => k.pubkey === address)
      if (myIndex === -1) continue

      const solDiff = tx.meta.postBalances[myIndex] - tx.meta.preBalances[myIndex]
      const isSolPayer = accountKeys[myIndex].signer

      const movements: Movement[] = []

      // SOL movement (if any net change beyond fee)
      const netSol = solDiff + (isSolPayer ? tx.meta.fee : 0) // remove fee to get pure value change
      if (Math.abs(netSol) > 0) {
        const zenSolSum = Math.round(netSol / SOL_DIVISOR)
        if (Math.abs(zenSolSum) > 0) {
          movements.push({
            id: sig.signature,
            account: { id: solAccId },
            invoice: null,
            sum: zenSolSum,
            fee: isSolPayer ? -Math.round(tx.meta.fee / SOL_DIVISOR) : 0
          })
        }
      }

      // SPL token movements
      for (const ta of tokenAccountInfos) {
        const taIndex = accountKeys.findIndex(k => k.pubkey === ta.pubkey)
        if (taIndex === -1) continue

        const pre = tx.meta.preTokenBalances.find(b => b.accountIndex === taIndex)
        const post = tx.meta.postTokenBalances.find(b => b.accountIndex === taIndex)
        const preAmt = pre !== undefined ? parseInt(pre.uiTokenAmount.amount) : 0
        const postAmt = post !== undefined ? parseInt(post.uiTokenAmount.amount) : 0
        const diff = postAmt - preAmt
        if (diff === 0) continue

        const meta = jupiterMap.get(ta.mint) ?? { symbol: `SPL_${ta.mint.slice(0, 8)}`, decimals: ta.decimals }
        const accId = `sol:${address}:${ta.mint}`
        const zenTokenSum = tokenAmountFromRaw(Math.abs(diff), meta.decimals)
        if (zenTokenSum === 0) continue

        movements.push({
          id: `${sig.signature}:${ta.mint}`,
          account: { id: accId },
          invoice: null,
          sum: diff > 0 ? zenTokenSum : -zenTokenSum,
          fee: 0
        })
      }

      if (movements.length === 0) continue

      // ZenMoney supports max 2 movements per transaction; emit one tx per movement
      for (const mov of movements) {
        allTransactions.push({
          hold: false,
          date: new Date((tx.blockTime ?? 0) * 1000),
          movements: [mov],
          merchant: null,
          comment: null
        })
      }
    }
  }

  ZenMoney.saveData()
  return { accounts: allAccounts, transactions: allTransactions }
}
