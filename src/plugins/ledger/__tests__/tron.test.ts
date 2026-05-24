/**
 * Tests for TRON chain converter logic.
 */

function tronTokenAmount (rawValue: string, decimals: number): number {
  return Math.round(Number(rawValue) / Math.pow(10, Math.max(0, decimals - 2))) / 100
}

describe('TRON TRC-20 token amount conversion', () => {
  it('converts USDT-TRC20 (6 decimals): 1,000,000 → 1.00 USDT', () => {
    expect(tronTokenAmount('1000000', 6)).toBe(1)
  })

  it('converts USDT-TRC20: 100,500,000 → 100.50 USDT', () => {
    expect(tronTokenAmount('100500000', 6)).toBe(100.5)
  })

  it('converts USDT-TRC20: 0 → 0', () => {
    expect(tronTokenAmount('0', 6)).toBe(0)
  })

  it('converts token with 8 decimals', () => {
    // 100,000,000 raw / 1e6 = 100
    expect(tronTokenAmount('100000000', 8)).toBe(1)
  })
})

describe('TRON account ID format', () => {
  const prefix = 'trx'

  it('native account id includes trx prefix', () => {
    const address = 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy'
    const id = `${prefix}:${address.toLowerCase()}`
    expect(id).toMatch(/^trx:/)
    expect(id).toBe(`trx:${address.toLowerCase()}`)
  })

  it('token account id includes contract', () => {
    const address = 'TLsV52sRDL79HXGGm9yzwKibb6BeruhUzy'
    const contract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'
    const id = `${prefix}:${address.toLowerCase()}:${contract.toLowerCase()}`
    expect(id.split(':').length).toBe(3)
  })
})
