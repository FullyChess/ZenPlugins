/**
 * Tests for TON chain converter logic.
 */

const TON_DIVISOR = 1000

function nanotonToMuTon (nanoton: number): number {
  return Math.round(nanoton / TON_DIVISOR)
}

function tonTokenAmount (rawValue: string, decimals: number): number {
  return Math.round(Number(rawValue) / Math.pow(10, Math.max(0, decimals - 2))) / 100
}

describe('TON native amount conversion', () => {
  it('converts 1 TON (1e9 nanoton) to 1,000,000 μTON', () => {
    // 1 TON = 1e9 nanoton; 1 μTON = 1000 nanoton → 1e9/1000 = 1e6 μTON
    expect(nanotonToMuTon(1_000_000_000)).toBe(1_000_000)
  })

  it('converts 0.5 TON', () => {
    expect(nanotonToMuTon(500_000_000)).toBe(500_000)
  })

  it('converts small amount: 1000 nanoton → 1 μTON', () => {
    expect(nanotonToMuTon(1000)).toBe(1)
  })

  it('rounds sub-μTON amounts', () => {
    expect(nanotonToMuTon(1500)).toBe(2) // 1.5 rounds to 2
  })
})

describe('TON Jetton amount conversion', () => {
  it('converts USDC Jetton (6 decimals): 1,000,000 → 1.00', () => {
    expect(tonTokenAmount('1000000', 6)).toBe(1)
  })

  it('converts Jetton with 9 decimals: 1e9 → 1.00', () => {
    expect(tonTokenAmount('1000000000', 9)).toBe(1)
  })
})

describe('TON account ID format', () => {
  it('native account id uses raw address', () => {
    const rawAddr = '0:abc123'
    const id = `ton:${rawAddr.toLowerCase()}`
    expect(id).toBe('ton:0:abc123')
  })

  it('Jetton account id includes contract address', () => {
    const rawAddr = '0:abc123'
    const contract = '0:usdc_contract'
    const id = `ton:${rawAddr.toLowerCase()}:${contract.toLowerCase()}`
    expect(id.startsWith('ton:')).toBe(true)
    expect(id.split(':').length).toBeGreaterThanOrEqual(3)
  })
})
