#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { probeEndpoints } from '../probe'
import PREV_TEST_BLOCKS from '../test-blocks.json'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const HISTORY_PATH = resolve(__dirname, '..', 'generated', 'rpcHistory.json')
const RPC_URLS_PATH = resolve(__dirname, '..', 'generated', 'rpcUrls.json')
const TEST_BLOCKS_PATH = resolve(__dirname, '..', 'test-blocks.json')

const GRADUATE = 2
const EXPEL = -5

function serializeTestBlocks(blocks: Record<number, number>): string {
  const sorted: Record<string, number> = {}
  for (const id of Object.keys(blocks).map(Number).sort((a, b) => a - b)) {
    sorted[id] = blocks[id]
  }
  return JSON.stringify(sorted, null, 2) + '\n'
}

function loadJSON<T>(path: string): T | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf-8'))
}

function loadHistory(): Record<number, Record<string, number>> {
  return loadJSON<Record<number, Record<string, number>>>(HISTORY_PATH) ?? {}
}

function saveHistory(h: Record<number, Record<string, number>>) {
  writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 2) + '\n')
}

function computeEffective(
  previousUrls: Record<number, string[]>,
  history: Record<number, Record<string, number>>,
): Record<number, string[]> {
  const result: Record<number, string[]> = {}
  const allChainIds = new Set([
    ...Object.keys(previousUrls).map(Number),
    ...Object.keys(history).map(Number),
  ])
  for (const cid of allChainIds) {
    const prev = previousUrls[cid] ?? []
    const chainHistory = history[cid] ?? {}
    const include = new Set<string>()

    for (const [url, count] of Object.entries(chainHistory)) {
      if (count >= GRADUATE) include.add(url)
    }
    for (const url of prev) {
      const count = chainHistory[url] ?? 0
      if (count > EXPEL) include.add(url)
    }

    if (include.size === 0) continue
    const urls: string[] = []
    const seen = new Set<string>()
    for (const url of prev) {
      if (include.has(url)) { urls.push(url); seen.add(url) }
    }
    for (const url of include) {
      if (!seen.has(url)) urls.push(url)
    }
    result[cid] = urls
  }
  return result
}

function hasRealChanges(
  cur: Record<number, string[]>,
  prev: Record<number, string[]>,
): boolean {
  const allCids = new Set([
    ...Object.keys(prev).map(Number),
    ...Object.keys(cur).map(Number),
  ])
  for (const cid of allCids) {
    const curUrls = new Set(cur[cid] ?? [])
    const prevUrls = prev[cid] ?? []
    if (prevUrls.length !== curUrls.size) return true
    if (!prevUrls.every(u => curUrls.has(u))) return true
  }
  return false
}

function printDiff(
  prev: Record<number, string[]>,
  cur: Record<number, string[]>,
  testBlocks: Record<number, number>,
) {
  const allCids = new Set([
    ...Object.keys(prev).map(Number),
    ...Object.keys(cur).map(Number),
  ])
  let hasChanges = false
  for (const cid of allCids) {
    const prevUrls = prev[cid] ?? []
    const curUrls = cur[cid] ?? []
    const added = curUrls.filter(u => !prevUrls.includes(u))
    const removed = prevUrls.filter(u => !curUrls.includes(u))
    if (added.length > 0 || removed.length > 0) {
      console.log(`  chain ${cid}: ${added.length} added, ${removed.length} removed`)
      for (const u of added) console.log(`    + ${u}`)
      for (const u of removed) console.log(`    - ${u}`)
      hasChanges = true
    }
  }
  if (!hasChanges) console.log('  no RPC changes')
  const newBlocks = Object.entries(testBlocks).filter(([k]) => !prev[Number(k)])
  if (newBlocks.length > 0) {
    console.log(`  new networks discovered: ${newBlocks.map(([k, v]) => `${k}@${v}`).join(', ')}`)
  }
}

function summarize(history: Record<number, Record<string, number>>): Record<string, { added: number; removed: number }> {
  const s: Record<string, { added: number; removed: number }> = {}
  for (const [cid, urls] of Object.entries(history)) {
    let added = 0, removed = 0
    for (const count of Object.values(urls)) {
      if (count >= GRADUATE) added++
      if (count <= EXPEL) removed++
    }
    s[cid] = { added, removed }
  }
  return s
}

async function main() {
  const { testBlocks, allResults, candidates } = await probeEndpoints()

  const history = loadHistory()

  for (const r of allResults) {
    if (!history[r.chainId]) history[r.chainId] = {}
    const prev = history[r.chainId][r.url] ?? 0
    if (r.ok && prev < 0) {
      history[r.chainId][r.url] = 1
    } else if (!r.ok && prev > 0) {
      history[r.chainId][r.url] = -1
    } else {
      history[r.chainId][r.url] = prev + (r.ok ? 1 : -1)
    }
  }

  for (const cidStr of Object.keys(history)) {
    const cid = Number(cidStr)
    const candidatesForChain = candidates[cid] ?? []
    const candidateUrls = new Set(candidatesForChain.map((c) => c.url))
    for (const url of Object.keys(history[cid])) {
      if (!candidateUrls.has(url)) delete history[cid][url]
    }
    if (Object.keys(history[cid]).length === 0) delete history[cid]
  }

  saveHistory(history)

  const previousUrls: Record<number, string[]> = loadJSON<Record<number, string[]>>(RPC_URLS_PATH) ?? {}
  const effective = computeEffective(previousUrls, history)

  const prevTestBlocks = { ...PREV_TEST_BLOCKS } as Record<number, number>
  const tbChanged =
    JSON.stringify(prevTestBlocks, Object.keys(prevTestBlocks).sort()) !==
    JSON.stringify(testBlocks, Object.keys(testBlocks).sort())

  const urlsChanged = hasRealChanges(effective, previousUrls)

  if (!urlsChanged && !tbChanged) {
    console.log('No meaningful changes')
    console.log(`HISTORY_SUMMARY=${JSON.stringify(summarize(history))}`)
    return
  }

  if (urlsChanged) {
    writeFileSync(RPC_URLS_PATH, JSON.stringify(effective, null, 2) + '\n')
    console.log(`Probe: written to ${RPC_URLS_PATH}`)
  }
  if (tbChanged) {
    writeFileSync(TEST_BLOCKS_PATH, serializeTestBlocks(testBlocks))
    console.log(`Probe: wrote ${Object.keys(testBlocks).length} test blocks to ${TEST_BLOCKS_PATH}`)
  }

  printDiff(previousUrls, effective, testBlocks)
  const newNetworks = Object.entries(testBlocks).filter(([k]) => !prevTestBlocks[Number(k)])
  const commitMsg = tbChanged
    ? `feat: discover ${newNetworks.map(([k]) => `chain ${k}`).join(', ')}`
    : 'fix: updated RPC endpoints'
  console.log(`COMMIT_MSG=${commitMsg}`)
  console.log(`HISTORY_SUMMARY=${JSON.stringify(summarize(history))}`)
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('Probe failed:', e)
    process.exit(1)
  },
)
