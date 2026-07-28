import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchRpcUrls } from './chainlist.js'

const SAMPLE_JS = `export const extraRpcs = {
  1: {
    rpcs: [
      "https://gnosischain.com/rpc",
      { url: "https://mainnet.infura.io/v3/abc", tracking: "none" },
      { url: "https://eth.llamarpc.com", tracking: "none" },
      { url: "http://localhost:8545", tracking: "none" },
      { url: "https://with-tracking.com", tracking: "yes" },
      { url: "https://no-tracking-field.com" }
    ]
  },
  137: {
    rpcs: [
      { url: "https://polygon.llamarpc.com", tracking: "none" }
    ]
  }
}
export const privacyStatement = "We collect minimal data"`

const CHAINLIST_URL = 'https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/extraRpcs.js'

describe('fetchRpcUrls', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches from the correct URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) })
    vi.stubGlobal('fetch', mockFetch)

    await fetchRpcUrls([1])

    expect(mockFetch).toHaveBeenCalledWith(CHAINLIST_URL)
  })

  it('extracts https URLs: strings, tracking:none, and no tracking field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([1])

    expect(result[1]).toContain('https://gnosischain.com/rpc')
    expect(result[1]).toContain('https://mainnet.infura.io/v3/abc')
    expect(result[1]).toContain('https://eth.llamarpc.com')
    expect(result[1]).toContain('https://no-tracking-field.com')
    expect(result[1]).not.toContain('https://with-tracking.com')
    expect(result[1]).not.toContain('http://localhost:8545')
  })

  it('filters out non-https URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([1])

    expect(result[1]).not.toContain('http://localhost:8545')
  })

  it('filters out tracking:"yes" URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([1])

    expect(result[1]).not.toContain('https://with-tracking.com')
  })

  it('includes RPCs that are plain strings (not objects)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([1])

    expect(result[1]).toContain('https://gnosischain.com/rpc')
  })

  it('includes RPCs with no tracking field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([1])

    expect(result[1]).toContain('https://no-tracking-field.com')
  })

  it('returns empty array for unknown chainIds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([999])

    expect(result[999]).toEqual([])
  })

  it('handles multiple chainIds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([1, 137])

    expect(result[1]).toHaveLength(4)
    expect(result[137]).toHaveLength(1)
    expect(result[137][0]).toBe('https://polygon.llamarpc.com')
  })

  it('handles fetch failure gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))

    const result = await fetchRpcUrls([1])

    expect(result).toEqual({})
  })

  it('returns empty Record for empty chainIds array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([])

    expect(result).toEqual({})
  })

  it('falls back to hardcoded RPCs for chains not in chainlist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(SAMPLE_JS) }))

    const result = await fetchRpcUrls([73799])

    expect(result[73799]).toEqual(['https://volta-rpc.energyweb.org'])
  })
})
