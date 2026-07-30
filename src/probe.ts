import { deployments } from 'ethr-did-resolver'
import { fetchRpcUrls, RpcCandidate } from './chainlist.js'
import { testRpcUrl } from './rpcTester.js'
import { discoverBlocks } from './discover-blocks.js'
import { TEST_BLOCKS } from './test-blocks.js'
import { getRegistry, trackingRank } from './shared.js'

const PROBE_TIMEOUT = 5_000

export type TestRecord = {
  chainId: number
  url: string
  ok: boolean
  latencyMs: number
  tracking: string | undefined
  index: number
}

export type ProbeResult = {
  workingUrls: Record<number, string[]>
  testBlocks: Record<number, number>
  allResults: TestRecord[]
  candidates: Record<number, RpcCandidate[]>
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

  const chainNames = new Map(deployments.map((d) => [Number(d.chainId), d.name]))

  for (const [chainId, urls] of Object.entries(candidates)) {
    const name = chainNames.get(Number(chainId)) ?? '?'
    console.log(`  chain ${chainId} (${name}): ${urls.length} candidates`)
  }

  console.log('Probe: testing each URL for connectivity + archival access...')
  const tests = Object.entries(candidates).flatMap(([chainId, chainCandidates]: [string, RpcCandidate[]]) =>
    chainCandidates.map(async (candidate, index) => {
      const url = candidate.url
      try {
        const result = await testRpcUrl(Number(chainId), url, getRegistry(Number(chainId)), PROBE_TIMEOUT, testBlocks)
        const name = chainNames.get(Number(chainId)) ?? '?'
        const icon = result.ok ? 'OK' : 'FAIL'
        console.log(`  ${icon} [${name}] ${url} (${result.latencyMs.toFixed(0)}ms)`)
        return { ...result, tracking: candidate.tracking, index }
      } catch {
        const name = chainNames.get(Number(chainId)) ?? '?'
        console.log(`  FAIL [${name}] ${url} (timeout >${PROBE_TIMEOUT}ms)`)
        return {
          chainId: Number(chainId),
          url,
          ok: false,
          latencyMs: PROBE_TIMEOUT,
          tracking: candidate.tracking,
          index,
        }
      }
    }),
  )
  const allResults: TestRecord[] = await Promise.all(tests)

  const byChain = new Map<number, Array<{ url: string; latencyMs: number; tracking: string | undefined; index: number }>>()
  for (const r of allResults) {
    if (!r.ok) continue
    const items = byChain.get(r.chainId) ?? []
    items.push({ url: r.url, latencyMs: r.latencyMs, tracking: r.tracking, index: r.index })
    byChain.set(r.chainId, items)
  }

  const workingUrls: Record<number, string[]> = {}
  for (const [chainId, items] of byChain) {
    items.sort((a, b) => {
      const diff = trackingRank(a.tracking) - trackingRank(b.tracking)
      if (diff !== 0) return diff
      return a.index - b.index
    })
    workingUrls[chainId] = items.map((i) => i.url)
  }

  console.log(`Probe: ${Object.keys(workingUrls).length} chains with working RPCs`)
  for (const [chainId, urls] of Object.entries(workingUrls)) {
    const name = chainNames.get(Number(chainId)) ?? '?'
    console.log(`  chain ${chainId} (${name}): ${urls.length} working RPCs`)
    for (const url of urls) console.log(`    ${url}`)
  }

  return { workingUrls, testBlocks, allResults, candidates }
}
