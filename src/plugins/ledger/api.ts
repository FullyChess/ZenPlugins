import { fetchJson } from '../../common/network'
import { BASE_URL } from './config'
import type { AccountTransaction, AddressBalance, LedgerPage, UtxoTransaction } from './types'

async function get<T> (path: string): Promise<T> {
  const response = await fetchJson(`${BASE_URL}${path}`)
  if (response.status !== 200) {
    throw new Error(`Ledger API error ${response.status}: ${path}`)
  }
  return response.body as T
}

export async function fetchBalance (coin: string, address: string): Promise<AddressBalance> {
  return await get<AddressBalance>(`/${coin}/addresses/${address}/balance`)
}

export async function fetchUtxoTransactions (
  coin: string,
  address: string,
  fromDate: Date
): Promise<UtxoTransaction[]> {
  const results: UtxoTransaction[] = []
  let cursor: string | undefined

  do {
    const path = cursor !== undefined
      ? `/${coin}/addresses/${address}/transactions?token=${encodeURIComponent(cursor)}`
      : `/${coin}/addresses/${address}/transactions`

    const page = await get<LedgerPage<UtxoTransaction>>(path)

    const fresh = page.data.filter(tx => new Date(tx.received_at) >= fromDate)
    results.push(...fresh)

    // stop paginating once we reach transactions older than fromDate
    cursor = fresh.length === page.data.length ? page.token : undefined
  } while (cursor !== undefined)

  return results
}

export async function fetchAccountTransactions (
  coin: string,
  address: string,
  fromDate: Date
): Promise<AccountTransaction[]> {
  const results: AccountTransaction[] = []
  let cursor: string | undefined

  do {
    const path = cursor !== undefined
      ? `/${coin}/addresses/${address}/transactions?token=${encodeURIComponent(cursor)}`
      : `/${coin}/addresses/${address}/transactions`

    const page = await get<LedgerPage<AccountTransaction>>(path)

    const fresh = page.data.filter(tx => new Date(tx.received_at) >= fromDate)
    results.push(...fresh)

    cursor = fresh.length === page.data.length ? page.token : undefined
  } while (cursor !== undefined)

  return results
}
