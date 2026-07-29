import { beforeEach, describe, expect, it, vi } from 'vitest'
import { testRpcUrl } from './rpcTester.js'
import { FetchRequest, JsonRpcProvider } from 'ethers'

vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')
  return {
    ...actual,
    JsonRpcProvider: vi.fn(),
    FetchRequest: vi.fn(function (this: any, url: string) {
      this.url = url
      this.timeout = 5000
    }),
  }
})

function makeMockProvider(overrides: Record<string, any> = {}) {
  return {
    send: vi.fn(),
    destroy: vi.fn(),
    ...overrides,
  }
}

describe('testRpcUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  it('returns ok:true when connectivity and archival checks pass', async () => {
    const provider = makeMockProvider()
    provider.send
      .mockResolvedValueOnce('0x1')
      .mockResolvedValueOnce([{ blockNumber: '0x1' }])
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    const result = await testRpcUrl(1, 'https://example.com/rpc', '0xdca7ef03e98e0dc2b855be647c39abe984fcf21b')

    expect(result.ok).toBe(true)
    expect(result.chainId).toBe(1)
    expect(result.url).toBe('https://example.com/rpc')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.latencyMs).toBeLessThan(10000)
  })

  it('returns ok:false when eth_blockNumber fails', async () => {
    const provider = makeMockProvider()
    provider.send.mockRejectedValueOnce(new Error('NETWORK_ERROR'))
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    const result = await testRpcUrl(1, 'https://example.com/rpc', '0xdca7ef03e98e0dc2b855be647c39abe984fcf21b')

    expect(result.ok).toBe(false)
    expect(result.chainId).toBe(1)
  })

  it('returns ok:false when archival check returns empty', async () => {
    const provider = makeMockProvider()
    provider.send
      .mockResolvedValueOnce('0x1')
      .mockResolvedValueOnce([])
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    const result = await testRpcUrl(1, 'https://example.com/rpc', '0xdca7ef03e98e0dc2b855be647c39abe984fcf21b')

    expect(result.ok).toBe(false)
    expect(result.chainId).toBe(1)
  })

  it('returns ok:false when archival check throws error', async () => {
    const provider = makeMockProvider()
    provider.send
      .mockResolvedValueOnce('0x1')
      .mockRejectedValueOnce(new Error('CALL_EXCEPTION'))
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    const result = await testRpcUrl(1, 'https://example.com/rpc', '0xdca7ef03e98e0dc2b855be647c39abe984fcf21b')

    expect(result.ok).toBe(false)
  })

  it('measures latency', async () => {
    const provider = makeMockProvider()
    provider.send
      .mockResolvedValueOnce('0x1')
      .mockResolvedValueOnce([{ blockNumber: '0x1' }])
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    const result = await testRpcUrl(1, 'https://example.com/rpc', '0xdca7ef03e98e0dc2b855be647c39abe984fcf21b')

    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(typeof result.latencyMs).toBe('number')
  })

  it('passes timeout to FetchRequest', async () => {
    let capturedReq: any = null
    const provider = makeMockProvider()
    provider.send.mockResolvedValueOnce('0x1').mockResolvedValueOnce([{ blockNumber: '0x1' }])
    ;(FetchRequest as any).mockImplementation(function (this: any, url: string) {
      capturedReq = { url, timeout: 15000 }
      return capturedReq
    })
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    await testRpcUrl(1, 'https://example.com/rpc', '0xdca7ef03e98e0dc2b855be647c39abe984fcf21b', 5_000)

    expect(capturedReq.timeout).toBe(5_000)
  })

  it('fails archival check for chains with no test block', async () => {
    const provider = makeMockProvider()
    provider.send
      .mockResolvedValueOnce('0x1')
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    const result = await testRpcUrl(999, 'https://example.com/rpc', '0xabc')

    expect(result.ok).toBe(false)
    expect(provider.send).toHaveBeenCalledTimes(1)
  })

  it('returns url, chainId, and latencyMs even on failure', async () => {
    const provider = makeMockProvider()
    provider.send.mockRejectedValueOnce(new Error('timeout'))
    ;(JsonRpcProvider as any).mockImplementation(function () { return provider })

    const result = await testRpcUrl(1, 'https://example.com/rpc', '0xdca7ef03e98e0dc2b855be647c39abe984fcf21b')

    expect(result.url).toBe('https://example.com/rpc')
    expect(result.chainId).toBe(1)
    expect(typeof result.latencyMs).toBe('number')
    expect(result.ok).toBe(false)
  })
})
