import {
  convertAccount,
  convertUtxoTransaction,
  convertAccountTransaction,
  mergeTransferTransactions
} from '../converters'
import { COIN_CONFIG } from '../config'
import type { UtxoTransaction, AccountTransaction } from '../types'

const btcConfig = COIN_CONFIG.btc
const ethConfig = COIN_CONFIG.eth

const MY_BTC = 'bc1qmyaddress'
const OTHER_BTC = 'bc1qotheraddress'

const MY_ETH = '0xMyAddress'
const OTHER_ETH = '0xOtherAddress'

describe('convertAccount', () => {
  it('converts BTC balance from satoshis to μBTC', () => {
    const account = convertAccount(MY_BTC, '100000', btcConfig)
    expect(account.instrument).toBe('μBTC')
    expect(account.balance).toBe(1000) // 100000 sat / 100 = 1000 μBTC
    expect(account.syncIds).toEqual([MY_BTC])
  })

  it('converts ETH balance from wei to μETH', () => {
    const account = convertAccount(MY_ETH, '1000000000000000000', ethConfig)
    expect(account.instrument).toBe('μETH')
    expect(account.balance).toBe(1000000) // 1e18 wei / 1e12 = 1e6 μETH = 1 ETH
  })
})

describe('convertUtxoTransaction', () => {
  const receivingTx: UtxoTransaction = {
    id: 'tx1',
    hash: 'abc123',
    received_at: '2024-01-15T10:00:00.000Z',
    fees: '1000',
    inputs: [{ input_index: 0, value: '500000', address: OTHER_BTC }],
    outputs: [
      { output_index: 0, value: '490000', address: MY_BTC },
      { output_index: 1, value: '9000', address: OTHER_BTC }
    ],
    block: { hash: 'block1', height: 800000, time: '2024-01-15T10:00:00.000Z' },
    confirmations: 6
  }

  const sendingTx: UtxoTransaction = {
    id: 'tx2',
    hash: 'def456',
    received_at: '2024-01-16T10:00:00.000Z',
    fees: '500',
    inputs: [{ input_index: 0, value: '490000', address: MY_BTC }],
    outputs: [
      { output_index: 0, value: '200000', address: OTHER_BTC },
      { output_index: 1, value: '289500', address: MY_BTC }
    ],
    block: { hash: 'block2', height: 800001, time: '2024-01-16T10:00:00.000Z' },
    confirmations: 5
  }

  it('converts incoming BTC transaction', () => {
    const tx = convertUtxoTransaction(MY_BTC, receivingTx, btcConfig)
    expect(tx).not.toBeNull()
    expect(tx?.movements[0].sum).toBe(4900) // 490000 sat / 100 = 4900 μBTC
    expect(tx?.movements[0].fee).toBe(0) // not the sender
    expect(tx?.hold).toBe(false)
    expect(tx?.date).toEqual(new Date('2024-01-15T10:00:00.000Z'))
  })

  it('converts outgoing BTC transaction', () => {
    const tx = convertUtxoTransaction(MY_BTC, sendingTx, btcConfig)
    expect(tx).not.toBeNull()
    // net: outputSum(289500) - inputSum(490000) = -200500 sat / 100 = -2005 μBTC
    expect(tx?.movements[0].sum).toBe(-2005)
    expect(tx?.movements[0].fee).toBe(-5) // 500 sat / 100 = 5 μBTC
    expect(tx?.hold).toBe(false)
  })

  it('returns null for unrelated transaction', () => {
    const unrelatedTx: UtxoTransaction = {
      ...receivingTx,
      inputs: [{ input_index: 0, value: '500000', address: OTHER_BTC }],
      outputs: [{ output_index: 0, value: '499000', address: OTHER_BTC }]
    }
    const tx = convertUtxoTransaction(MY_BTC, unrelatedTx, btcConfig)
    expect(tx).toBeNull()
  })

  it('marks unconfirmed transaction as hold', () => {
    const unconfirmedTx: UtxoTransaction = { ...receivingTx, block: undefined, confirmations: 0 }
    const tx = convertUtxoTransaction(MY_BTC, unconfirmedTx, btcConfig)
    expect(tx?.hold).toBe(true)
  })
})

describe('convertAccountTransaction', () => {
  const incomingTx: AccountTransaction = {
    hash: '0xtxhash1',
    received_at: '2024-02-01T12:00:00.000Z',
    value: '500000000000000000', // 0.5 ETH in wei
    gas: '21000',
    gas_price: '20000000000',
    gas_used: '21000',
    from: OTHER_ETH,
    to: MY_ETH,
    status: 1,
    confirmations: 10,
    block: { hash: 'block1', height: 19000000, time: '2024-02-01T12:00:00.000Z' }
  }

  const outgoingTx: AccountTransaction = {
    hash: '0xtxhash2',
    received_at: '2024-02-02T12:00:00.000Z',
    value: '1000000000000000000', // 1 ETH in wei
    gas: '21000',
    gas_price: '20000000000',
    gas_used: '21000',
    from: MY_ETH,
    to: OTHER_ETH,
    status: 1,
    confirmations: 5,
    block: { hash: 'block2', height: 19000001, time: '2024-02-02T12:00:00.000Z' }
  }

  it('converts incoming ETH transaction', () => {
    const tx = convertAccountTransaction(MY_ETH, incomingTx, ethConfig)
    expect(tx).not.toBeNull()
    expect(tx?.movements[0].sum).toBe(500000) // 0.5e18 / 1e12 = 500000 μETH
    expect(tx?.movements[0].fee).toBe(0)
  })

  it('converts outgoing ETH transaction', () => {
    const tx = convertAccountTransaction(MY_ETH, outgoingTx, ethConfig)
    expect(tx).not.toBeNull()
    expect(tx?.movements[0].sum).toBe(-1000000) // -1e18 / 1e12 = -1000000 μETH
    // fee: 20000000000 * 21000 = 420000000000000 wei / 1e12 = 420 μETH
    expect(tx?.movements[0].fee).toBe(-420)
  })

  it('skips failed transactions', () => {
    const failedTx: AccountTransaction = { ...incomingTx, status: 0 }
    const tx = convertAccountTransaction(MY_ETH, failedTx, ethConfig)
    expect(tx).toBeNull()
  })
})

describe('mergeTransferTransactions', () => {
  it('merges paired send/receive transactions with same hash into a transfer', () => {
    const sharedTx: UtxoTransaction = {
      id: 'tx1',
      hash: 'samehash',
      received_at: '2024-01-15T10:00:00.000Z',
      fees: '100',
      inputs: [{ input_index: 0, value: '100000', address: MY_BTC }],
      outputs: [{ output_index: 0, value: '99900', address: OTHER_BTC }],
      block: { hash: 'b1', height: 1, time: '' },
      confirmations: 6
    }

    const send = convertUtxoTransaction(MY_BTC, sharedTx, btcConfig)
    const receive = convertUtxoTransaction(OTHER_BTC, sharedTx, btcConfig)

    expect(send).not.toBeNull()
    expect(receive).not.toBeNull()

    const merged = mergeTransferTransactions([send as NonNullable<typeof send>, receive as NonNullable<typeof receive>])
    expect(merged).toHaveLength(1)
    expect(merged[0].movements).toHaveLength(2)
    expect(merged[0].merchant).toBeNull()
  })
})
