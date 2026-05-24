import { Account, AccountType, Movement, Transaction } from '../../types/zenmoney'
import { getDecimals } from './api'
import { LedgerExplorerTx, RawLedgerAccount } from './types'

// Ledger Live currency id → ZenMoney instrument code
const INSTRUMENT_MAP: Record<string, string> = {
  bitcoin: 'BTC',
  bitcoin_cash: 'BCH',
  bitcoin_gold: 'BTG',
  litecoin: 'LTC',
  dogecoin: 'DOGE',
  dash: 'DASH',
  zcash: 'ZEC',
  ethereum: 'ETH',
  ethereum_classic: 'ETC',
  solana: 'SOL',
  polkadot: 'DOT',
  ripple: 'XRP',
  stellar: 'XLM',
  tron: 'TRX',
  cosmos: 'ATOM',
  tezos: 'XTZ',
  cardano: 'ADA',
  avalanche_c_chain: 'AVAX',
  near: 'NEAR',
  ton: 'TON',
  algorand: 'ALGO'
}

function toFullUnit (smallestUnit: string, decimals: number): number {
  return Number(smallestUnit) / Math.pow(10, decimals)
}

export function convertAccount (raw: RawLedgerAccount): Account {
  const decimals = getDecimals(raw.currency)
  const instrument = INSTRUMENT_MAP[raw.currency] ?? raw.currency.toUpperCase()

  return {
    id: raw.id,
    type: AccountType.checking,
    title: raw.name.length > 0 ? raw.name : instrument,
    instrument,
    syncIds: [raw.address],
    balance: toFullUnit(raw.balance, decimals)
  }
}

export function convertAccounts (rawAccounts: RawLedgerAccount[]): Account[] {
  return rawAccounts.map(convertAccount)
}

function buildMovement (accountId: string, sum: number, fee: number, txId: string): Movement {
  return {
    id: txId,
    account: { id: accountId },
    invoice: null,
    sum,
    fee
  }
}

export function convertTransaction (
  tx: LedgerExplorerTx,
  account: RawLedgerAccount
): Transaction | null {
  // Only process confirmed transactions
  if (tx.block == null || tx.confirmations < 1) return null

  const decimals = getDecimals(account.currency)
  const address = account.address.toLowerCase()

  const inputTotal = tx.inputs
    .filter(i => i.address.toLowerCase() === address)
    .reduce((sum, i) => sum + Number(i.value), 0)

  const outputTotal = tx.outputs
    .filter(o => o.address.toLowerCase() === address)
    .reduce((sum, o) => sum + Number(o.value), 0)

  const netSmallest = outputTotal - inputTotal
  if (netSmallest === 0) return null

  const netFull = toFullUnit(String(Math.abs(netSmallest)), decimals)
  const feeFull = toFullUnit(tx.fees, decimals)

  const sum = netSmallest > 0 ? netFull : -netFull
  const fee = netSmallest < 0 ? feeFull : 0

  const movement = buildMovement(account.id, sum, fee, tx.hash)

  return {
    hold: false,
    date: new Date(tx.received_at),
    movements: [movement],
    merchant: {
      fullTitle: tx.hash,
      mcc: null,
      location: null
    },
    comment: null
  }
}

export function convertTransactions (
  txs: LedgerExplorerTx[],
  account: RawLedgerAccount
): Transaction[] {
  return txs
    .map(tx => convertTransaction(tx, account))
    .filter((tx): tx is Transaction => tx != null)
}
