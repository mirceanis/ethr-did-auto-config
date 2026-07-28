#!/usr/bin/env node
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { deployments } from 'ethr-did-resolver'
import { fetchRpcUrls } from './chainlist.js'
import { testRpcUrl } from './rpcTester.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const PROBE_TIMEOUT = 25_000

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

async function main() {
  const chainIds = deployments.map((d) => Number(d.chainId))
  console.log('Probe: loading chainlist...')
  const candidates = await fetchRpcUrls(chainIds)
  const totalCandidateUrls = Object.values(candidates).reduce((sum, urls) => sum + urls.length, 0)
  console.log(`Probe: found ${totalCandidateUrls} candidate RPC URLs across ${Object.keys(candidates).length} chains`)

  for (const [chainId, urls] of Object.entries(candidates)) {
    const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
    console.log(`  chain ${chainId} (${name}): ${urls.length} candidates`)
  }

  console.log('Probe: testing each URL for connectivity + archival access...')
  const tests = Object.entries(candidates).flatMap(([chainId, urls]) =>
    urls.map(async (url) => {
      try {
        const result = await withTimeout(
          testRpcUrl(Number(chainId), url, getRegistry(Number(chainId))),
          PROBE_TIMEOUT,
        )
        const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
        const icon = result.ok ? 'OK' : 'FAIL'
        console.log(`  ${icon} [${name}] ${url} (${result.latencyMs.toFixed(0)}ms)`)
        return result
      } catch {
        const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
        console.log(`  FAIL [${name}] ${url} (timeout >${PROBE_TIMEOUT}ms)`)
        return { chainId: Number(chainId), url, ok: false, latencyMs: PROBE_TIMEOUT }
      }
    }),
  )
  const results = await Promise.all(tests)

  const byChain = new Map<number, Array<{ url: string; latencyMs: number }>>()
  for (const r of results) {
    if (!r.ok) continue
    const items = byChain.get(r.chainId) ?? []
    items.push({ url: r.url, latencyMs: r.latencyMs })
    byChain.set(r.chainId, items)
  }

  const workingUrls: Record<number, string[]> = {}
  for (const [chainId, items] of byChain) {
    items.sort((a, b) => a.latencyMs - b.latencyMs)
    workingUrls[chainId] = items.map((i) => i.url)
  }

  console.log(`Probe: ${Object.keys(workingUrls).length} chains with working RPCs`)
  for (const [chainId, urls] of Object.entries(workingUrls)) {
    const name = deployments.find((d) => Number(d.chainId) === Number(chainId))?.name ?? '?'
    console.log(`  chain ${chainId} (${name}): ${urls.length} working RPCs`)
    for (const url of urls) console.log(`    ${url}`)
  }

  const outPath = resolve(__dirname, 'generated', 'rpcUrls.json')
  writeFileSync(outPath, JSON.stringify(workingUrls, null, 2) + '\n')
  console.log(`Probe: written to ${outPath}`)
}

main().catch((e) => {
  console.error('Probe failed:', e)
  process.exit(1)
})
