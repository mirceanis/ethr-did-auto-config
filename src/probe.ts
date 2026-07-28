import { deployments } from 'ethr-did-resolver'
import { fetchRpcUrls, RpcCandidate } from './chainlist.js'
import { testRpcUrl } from './rpcTester.js'
import { discoverBlocks } from './discover-blocks.js'
import { TEST_BLOCKS } from './test-blocks.js'

const PROBE_TIMEOUT = 5_000

function getRegistry(chainId: number): string {
  return deployments.find((d) => Number(d.chainId) === chainId)?.registry ?? ''
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timeout')), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function trackingRank(t: string | undefined): number {
  return t === 'none' ? 0 : t === 'limited' ? 1 : 2
}

export type ProbeResult = {
  workingUrls: Record<number, string[]>
  testBlocks: Record<number, number>
}

export async function probeEndpoints(): Promise<ProbeResult> {
  const chainIds = deployments.map((d) => Number(d.chainId))

  const missingChains = chainIds.filter((id) => !(id in TEST_BLOCKS))
  let testBlocks = { ...TEST_BLOCKS } as Record<number, number>
  if (missingChains.length > 0) {
    console.log(`Probe: ${missingChains.length} new network(s) without TEST_BLOCKS, discovering...`)
    testBlocks = await discoverBlocks()
  }

  console.log('Probe: loading chainlist...')
  const candidates = await fetchRpcUrls(chainIds)
  const totalCandidateUrls = Object.values(candidates).reduce((sum, urls) => sum + urls.length, 0)
  console.log(`Probe: found ${totalCandidateUrls} candidate RPC URLs across ${Object.keys(candidates).length} chains`)

  for (const [chainId, urls] of Object.entries(candidates)) {
    const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
    console.log(`  chain ${chainId} (${name}): ${urls.length} candidates`)
  }

  console.log('Probe: testing each URL for connectivity + archival access...')
  type TestResult = { chainId: number; url: string; ok: boolean; latencyMs: number; tracking: string | undefined }
  const tests = Object.entries(candidates).flatMap(([chainId, chainCandidates]: [string, RpcCandidate[]]) =>
    chainCandidates.map(async (candidate) => {
      const url = candidate.url
      try {
        const result = await withTimeout(
          testRpcUrl(Number(chainId), url, getRegistry(Number(chainId)), PROBE_TIMEOUT, testBlocks),
          PROBE_TIMEOUT,
        )
        const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
        const icon = result.ok ? 'OK' : 'FAIL'
        console.log(`  ${icon} [${name}] ${url} (${result.latencyMs.toFixed(0)}ms)`)
        return { ...result, tracking: candidate.tracking }
      } catch {
        const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
        console.log(`  FAIL [${name}] ${url} (timeout >${PROBE_TIMEOUT}ms)`)
        return {
          chainId: Number(chainId),
          url,
          ok: false,
          latencyMs: PROBE_TIMEOUT,
          tracking: candidate.tracking,
        }
      }
    }),
  )
  const results: TestResult[] = await Promise.all(tests)

  const byChain = new Map<number, Array<{ url: string; latencyMs: number; tracking: string | undefined }>>()
  for (const r of results) {
    if (!r.ok) continue
    const items = byChain.get(r.chainId) ?? []
    items.push({ url: r.url, latencyMs: r.latencyMs, tracking: r.tracking })
    byChain.set(r.chainId, items)
  }

  const workingUrls: Record<number, string[]> = {}
  for (const [chainId, items] of byChain) {
    items.sort((a, b) => {
      const diff = trackingRank(a.tracking) - trackingRank(b.tracking)
      if (diff !== 0) return diff
      return a.latencyMs - b.latencyMs
    })
    workingUrls[chainId] = items.map((i) => i.url)
  }

  console.log(`Probe: ${Object.keys(workingUrls).length} chains with working RPCs`)
  for (const [chainId, urls] of Object.entries(workingUrls)) {
    const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
    console.log(`  chain ${chainId} (${name}): ${urls.length} working RPCs`)
    for (const url of urls) console.log(`    ${url}`)
  }

  return { workingUrls, testBlocks }
}
