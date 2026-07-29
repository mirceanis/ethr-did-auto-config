import { trackingRank } from './shared.js'

const CHAINLIST_URL = 'https://chainlist.org/rpcs.json'

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
    const chains = (await response.json()) as { chainId: number; rpc: { url: string; tracking?: string }[] }[]

    const chainMap = new Map(chains.map((c) => [c.chainId, c.rpc]))

    const result: Record<number, RpcCandidate[]> = {}
    for (const chainId of chainIds) {
      const rpcs = chainMap.get(chainId)
      if (!rpcs) {
        result[chainId] = []
        continue
      }
      result[chainId] = rpcs
        .filter((rpc) => typeof rpc.url === 'string' && rpc.url.startsWith('https://'))
        .map((rpc) => ({ url: rpc.url, tracking: rpc.tracking }))
        .sort((a, b) => trackingRank(a.tracking) - trackingRank(b.tracking))
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