import { describe, it, expect, vi } from 'vitest'

vi.mock('ethr-did-resolver', () => ({
  deployments: [
    { chainId: 1, registry: '0xreg1', name: 'mainnet', legacyNonce: true },
    { chainId: 137, registry: '0xreg137', name: 'polygon', legacyNonce: false },
    { chainId: 999, registry: '0xreg999', name: 'unknown' },
  ],
}))

vi.mock('./failoverProvider.js', () => ({
  buildFailoverProvider: vi.fn((chainId, urls) => ({
    _type: 'FailoverProvider',
    chainId,
    rpcUrls: urls,
  })),
}))

vi.mock('./generated/rpcUrls.json', () => ({
  default: {
    '1': ['https://cached-rpc.com'],
  },
}))

import { ethrAutoConfig } from './autoConfig.js'
import { buildFailoverProvider } from './failoverProvider.js'

describe('ethrAutoConfig', () => {
  it('builds networks from cached rpcUrls by default', () => {
    const config = ethrAutoConfig()

    expect(config.networks).toHaveLength(1)
    expect(config.networks[0].chainId).toBe(1)
    expect(config.networks[0].name).toBe('mainnet')
    expect(config.networks[0].registry).toBe('0xreg1')
    expect(config.networks[0].legacyNonce).toBe(true)
    expect(config.networks[0].provider.rpcUrls).toEqual(['https://cached-rpc.com'])
  })

  it('uses custom rpcUrls when provided', () => {
    const customUrls = { '137': ['https://custom-polygon.com'] }

    const config = ethrAutoConfig({ rpcUrls: customUrls })

    expect(config.networks).toHaveLength(1)
    expect(config.networks[0].chainId).toBe(137)
    expect(config.networks[0].provider.rpcUrls).toEqual(['https://custom-polygon.com'])
  })

  it('filters out chains with no RPC URLs', () => {
    const config = ethrAutoConfig({ rpcUrls: {} })

    expect(config.networks).toHaveLength(0)
  })

  it('passes chainId and urls to buildFailoverProvider', () => {
    ethrAutoConfig()

    expect(buildFailoverProvider).toHaveBeenCalledWith(1, ['https://cached-rpc.com'])
  })
})
