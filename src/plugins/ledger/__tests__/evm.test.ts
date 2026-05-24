/**
 * Tests for EVM chain converter logic (ETH + Polygon).
 * We test the pure data-transformation parts extracted from evm.ts.
 */

// Inline the helpers we want to test (same logic as in evm.ts)
const ETH_DIVISOR = 1e12

function nativeAccountId (chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`
}

function tokenAccountId (chainId: number, address: string, contract: string): string {
  return `${chainId}:${address.toLowerCase()}:${contract.toLowerCase()}`
}

function evmTokenAmount (rawValue: string, decimals: number): number {
  return Math.round(Number(rawValue) / Math.pow(10, Math.max(0, decimals - 2))) / 100
}

function nativeSum (rawWei: string, isSender: boolean): number {
  const zenValue = Math.round(Number(rawWei) / ETH_DIVISOR)
  return isSender ? -zenValue : zenValue
}

describe('EVM account IDs', () => {
  it('generates deterministic native account id', () => {
    expect(nativeAccountId(1, '0xAbCdEf')).toBe('1:0xabcdef')
    expect(nativeAccountId(137, '0xAbCdEf')).toBe('137:0xabcdef')
  })

  it('generates deterministic token account id', () => {
    const id = tokenAccountId(1, '0xMyAddr', '0xTokenContract')
    expect(id).toBe('1:0xmyaddr:0xtokencontract')
  })

  it('different chains produce different ids for same address', () => {
    const ethId = nativeAccountId(1, '0xSame')
    const maticId = nativeAccountId(137, '0xSame')
    expect(ethId).not.toBe(maticId)
  })
})

describe('tokenAmount conversion', () => {
  it('converts USDC (6 decimals): 1,000,000 raw → 1.00', () => {
    expect(evmTokenAmount('1000000', 6)).toBe(1)
  })

  it('converts USDC: 1,500,000 raw → 1.50', () => {
    expect(evmTokenAmount('1500000', 6)).toBe(1.5)
  })

  it('converts USDT (6 decimals): 100,000,000 → 100.00', () => {
    expect(evmTokenAmount('100000000', 6)).toBe(100)
  })

  it('converts token with 18 decimals: 1e18 → 1.00', () => {
    // 1e18 raw / 1e16 = 100 → /100 = 1.00
    expect(evmTokenAmount('1000000000000000000', 18)).toBe(1)
  })

  it('converts token with 18 decimals: 1.5 tokens', () => {
    expect(evmTokenAmount('1500000000000000000', 18)).toBe(1.5)
  })
})

describe('native ETH amount conversion', () => {
  it('converts 1 ETH in wei to μETH for receiver', () => {
    // 1 ETH = 1e18 wei / 1e12 = 1e6 μETH
    expect(nativeSum('1000000000000000000', false)).toBe(1000000)
  })

  it('negates for sender', () => {
    expect(nativeSum('1000000000000000000', true)).toBe(-1000000)
  })

  it('converts 0.5 ETH', () => {
    expect(nativeSum('500000000000000000', false)).toBe(500000)
  })
})
