import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const CHAINLIST_URL = 'https://raw.githubusercontent.com/DefiLlama/chainlist/main/constants/extraRpcs.js'

const HARDCODED_RPCS: Record<number, string[]> = {
  73799: ['https://volta-rpc.energyweb.org'],
}

export async function fetchRpcUrls(chainIds: number[]): Promise<Record<number, string[]>> {
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

    const result: Record<number, string[]> = {}
    for (const chainId of chainIds) {
      const chainData = extraRpcs[chainId]
      if (!chainData) {
        result[chainId] = []
        continue
      }
      result[chainId] = chainData.rpcs
        .filter((rpc: any) => {
          const url = typeof rpc === 'string' ? rpc : rpc.url
          return typeof url === 'string' && url.startsWith('https://') && rpc.tracking !== 'yes' && rpc.tracking !== 'limited'
        })
        .map((rpc: any) => {
          if (typeof rpc === 'string') return rpc
          return rpc.url
        })
    }
    for (const chainId of chainIds) {
      const hardcoded = HARDCODED_RPCS[chainId]
      if (hardcoded) {
        const existing = result[chainId] ?? []
        const seen = new Set(existing)
        result[chainId] = existing.concat(hardcoded.filter((url) => !seen.has(url)))
      }
    }
    return result
  } catch {
    return {}
  }
}
