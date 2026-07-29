#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { probeEndpoints } from '../src/probe.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const HISTORY_PATH = resolve(__dirname, '..', 'src', 'generated', 'rpcHistory.json')
const RPC_URLS_PATH = resolve(__dirname, '..', 'src', 'generated', 'rpcUrls.json')
const TEST_BLOCKS_PATH = resolve(__dirname, '..', 'src', 'test-blocks.ts')

const GRADUATE = 2
const EXPEL = -5

function loadHistory(): Record<number, Record<string, number>> {
  if (!existsSync(HISTORY_PATH)) return {}
  return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'))
}

function saveHistory(h: Record<number, Record<string, number>>) {
  writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 2) + '\n')
}

function loadTestBlocks(path: string): Record<number, number> {
  const src = readFileSync(path, 'utf-8')
  const m = src.match(/\{([^}]+)\}/)
  if (!m) return {}
  const pairs = m[1].trim().split('\n').map(l => l.trim()).filter(Boolean)
  const result: Record<number, number> = {}
  for (const p of pairs) {
    const [k, v] = p.replace(/,?$/, '').split(':').map(s => s.trim())
    result[Number(k)] = Number(v)
  }
  return result
}

function formatTestBlocks(blocks: Record<number, number>): string {
  const chainIds = Object.keys(blocks).map(Number).sort((a, b) => a - b)
  const body = chainIds.map((id) => `    ${id}: ${blocks[id]},`).join('\n')
  return `export const TEST_BLOCKS: Record<number, number> = {\n${body}\n} as const\n`
}

function summarize(history: Record<number, Record<string, number>>): Record<string, { added: number; removed: number }> {
  const s: Record<string, { added: number; removed: number }> = {}
  for (const [cid, urls] of Object.entries(history)) {
    const name = cid
    let added = 0, removed = 0
    for (const count of Object.values(urls)) {
      if (count >= GRADUATE) added++
      if (count <= EXPEL) removed++
    }
    s[name] = { added, removed }
  }
  return s
}

function logDiff(
  prev: Record<number, string[]>,
  cur: Record<number, string[]>,
  testBlocks: Record<number, number>,
) {
  const chainIds = new Set([...Object.keys(prev), ...Object.keys(cur)].map(Number))
  let hasChanges = false
  for (const cid of chainIds) {
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
  const newBlocks = Object.entries(testBlocks).filter(([k]) => !prev[k])
  if (newBlocks.length > 0) {
    console.log(`  new networks discovered: ${newBlocks.map(([k, v]) => `${k}@${v}`).join(', ')}`)
  }
}

async function main() {
  const { workingUrls, testBlocks, allResults, candidates } = await probeEndpoints()

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

  const graduated: Record<number, string[]> = {}
  for (const cidStr of Object.keys(history)) {
    const cid = Number(cidStr)
    const urls = Object.entries(history[cid])
      .filter(([_, count]) => count >= GRADUATE)
      .map(([url]) => url)
      .sort()
    if (urls.length > 0) graduated[cid] = urls
  }

  const previousUrls: Record<number, string[]> = existsSync(RPC_URLS_PATH)
    ? JSON.parse(readFileSync(RPC_URLS_PATH, 'utf-8'))
    : {}

  const prevUrlsJson = JSON.stringify(previousUrls, Object.keys(previousUrls).sort())
  const curUrlsJson = JSON.stringify(graduated, Object.keys(graduated).sort())
  const urlsChanged = prevUrlsJson !== curUrlsJson

  const prevTestBlocks: Record<number, number> = existsSync(TEST_BLOCKS_PATH)
    ? loadTestBlocks(TEST_BLOCKS_PATH)
    : {}
  const testBlocksChanged =
    JSON.stringify(prevTestBlocks, Object.keys(prevTestBlocks).sort()) !==
    JSON.stringify(testBlocks, Object.keys(testBlocks).sort())

  if (!urlsChanged && !testBlocksChanged) {
    console.log('No meaningful changes — graduated RPC set is identical to current rpcUrls.json')
    console.log(`HISTORY_SUMMARY=${JSON.stringify(summarize(history))}`)
    return
  }

  if (urlsChanged) {
    writeFileSync(RPC_URLS_PATH, JSON.stringify(graduated, null, 2) + '\n')
    console.log(`Probe: written to ${RPC_URLS_PATH}`)
  }
  if (testBlocksChanged) {
    writeFileSync(TEST_BLOCKS_PATH, formatTestBlocks(testBlocks))
    console.log(`Probe: wrote ${Object.keys(testBlocks).length} test blocks to ${TEST_BLOCKS_PATH}`)
  }

  logDiff(previousUrls, graduated, testBlocks)
  const commitType = testBlocksChanged ? 'feat' : 'fix'
  const newNetworks = Object.entries(testBlocks).filter(([k]) => !prevTestBlocks[k])
  const commitMsg = testBlocksChanged
    ? `feat: discover ${newNetworks.map(([k, v]) => `chain ${k}`).join(', ')}`
    : 'fix: updated RPC endpoints'
  console.log(`COMMIT_TYPE=${commitType}`)
  console.log(`COMMIT_MSG=${commitMsg}`)
  console.log(`HISTORY_SUMMARY=${JSON.stringify(summarize(history))}`)
}

main().catch((e) => {
  console.error('Probe failed:', e)
  process.exit(1)
})
