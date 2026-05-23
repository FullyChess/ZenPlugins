import type { Account, Transaction } from '../../types/zenmoney'
import { AccountType } from '../../types/zenmoney'
import type { AccountTransaction, CoinConfig, UtxoTransaction } from './types'

function toZenSum (rawValue: string, divisor: number): number {
  return Math.round(Number(rawValue) / divisor)
}

export function convertAccount (
  address: string,
  rawBalance: string,
  config: CoinConfig
): Account {
  return {
    id: address,
    type: AccountType.checking,
    title: address,
    instrument: config.instrument,
    balance: toZenSum(rawBalance, config.divisor),
    syncIds: [address]
  }
}

export function convertUtxoTransaction (
  address: string,
  tx: UtxoTransaction,
  config: CoinConfig
): Transaction | null {
  const inputSum = tx.inputs
    .filter(i => i.address === address)
    .reduce((acc, i) => acc + Number(i.value), 0)

  const outputSum = tx.outputs
    .filter(o => o.address === address)
    .reduce((acc, o) => acc + Number(o.value), 0)

  const isSender = inputSum > 0
  const netValue = outputSum - inputSum // negative if sending, positive if receiving
  const zenSum = Math.round(netValue / config.divisor)

  if (zenSum === 0) return null

  const fee = isSender ? -Math.round(Number(tx.fees) / config.divisor) : 0

  const counterAddress = isSender
    ? (tx.outputs.find(o => o.address !== address)?.address ?? tx.outputs[0]?.address ?? '')
    : (tx.inputs[0]?.address ?? '')

  return {
    hold: tx.block === undefined,
    date: new Date(tx.received_at),
    movements: [
      {
        id: tx.hash,
        account: { id: address },
        invoice: null,
        sum: zenSum,
        fee
      }
    ],
    merchant: counterAddress !== ''
      ? { fullTitle: counterAddress, mcc: null, location: null }
      : null,
    comment: null
  }
}

export function convertAccountTransaction (
  address: string,
  tx: AccountTransaction,
  config: CoinConfig
): Transaction | null {
  if (tx.status === 0) return null // failed transaction

  const isSender = tx.from.toLowerCase() === address.toLowerCase()
  const zenValue = toZenSum(tx.value, config.divisor)

  if (zenValue === 0) return null

  const zenFee = isSender
    ? -Math.round((Number(tx.gas_price) * Number(tx.gas_used)) / config.divisor)
    : 0

  const counterAddress = isSender ? tx.to : tx.from

  return {
    hold: tx.block === undefined,
    date: new Date(tx.received_at),
    movements: [
      {
        id: tx.hash,
        account: { id: address },
        invoice: null,
        sum: isSender ? -zenValue : zenValue,
        fee: zenFee
      }
    ],
    merchant: {
      fullTitle: counterAddress,
      mcc: null,
      location: null
    },
    comment: null
  }
}

export function mergeTransferTransactions (transactions: Transaction[]): Transaction[] {
  const result: Transaction[] = []
  const used = new Set<number>()

  for (let i = 0; i < transactions.length; i++) {
    if (used.has(i)) continue

    const tx = transactions[i]
    const mov = tx.movements[0]
    if (mov == null || mov.id == null) {
      result.push(tx)
      continue
    }

    let pairIdx = -1
    for (let j = i + 1; j < transactions.length; j++) {
      if (used.has(j)) continue
      const candidate = transactions[j]
      const candMov = candidate.movements[0]
      if (candMov?.id !== mov.id) continue
      if (mov.sum != null && candMov?.sum != null && mov.sum * candMov.sum < 0) {
        pairIdx = j
        break
      }
    }

    if (pairIdx === -1) {
      result.push(tx)
      continue
    }

    used.add(pairIdx)
    const pair = transactions[pairIdx]
    const pairMov = pair.movements[0]
    if (pairMov == null) {
      result.push(tx)
      continue
    }

    result.push({
      ...tx,
      movements: [mov, pairMov],
      merchant: null
    })
  }

  return result
}
