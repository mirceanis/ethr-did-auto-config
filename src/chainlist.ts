import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { trackingRank } from './shared.js'

const CHAINLIST_URL = 'https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/extraRpcs.js'

const HARDCODED_RPCS: Record<number, string[]> = {
  73799: ['https://volta-rpc.energyweb.org'],
}

export type RpcCandidate = {
  url: string
  tracking: string | undefined
}

export async function fetchRpcUrls(chainIds: number[]): Promise<Record<number, RpcCandidate[]>> {
  if (chainIds.length === 0) return {}

  try {
    const response = await fetch(CHAINLIST_URL)
    const js = await response.text()

    const tmpDir = mkdtempSync(join(tmpdir(), 'chainlist-'))
    const tmpFile = join(tmpDir, 'extraRpcs.mjs')
    writeFileSync(tmpFile, js)
    const mod = await import(tmpFile)
    import('fs/promises').then(fs => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}))

    const extraRpcs: Record<number, { rpcs: { url: string; tracking: string }[] }> = mod.extraRpcs

    const result: Record<number, RpcCandidate[]> = {}
    for (const chainId of chainIds) {
      const chainData = extraRpcs[chainId]
      if (!chainData) {
        result[chainId] = []
        continue
      }
      result[chainId] = chainData.rpcs
        .filter((rpc: any) => {
          const url = typeof rpc === 'string' ? rpc : rpc.url
          return typeof url === 'string' && url.startsWith('https://')
        })
        .map((rpc: any) => {
          if (typeof rpc === 'string') return { url: rpc, tracking: undefined }
          return { url: rpc.url, tracking: rpc.tracking }
        })
        .sort((a: RpcCandidate, b: RpcCandidate) => trackingRank(a.tracking) - trackingRank(b.tracking))
    }
    for (const chainId of chainIds) {
      const hardcoded = HARDCODED_RPCS[chainId]
      if (hardcoded) {
        const existing = result[chainId] ?? []
        const seen = new Set(existing.map((c) => c.url))
        for (const url of hardcoded) {
          if (!seen.has(url)) {
            existing.push({ url, tracking: undefined })
          }
        }
      }
    }
    return result
  } catch {
    return {}
  }
}
