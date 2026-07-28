#!/usr/bin/env node
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { probeEndpoints } from '../src/probe.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function formatTestBlocks(blocks: Record<number, number>): string {
  const chainIds = Object.keys(blocks).map(Number).sort((a, b) => a - b)
  const body = chainIds.map((id) => `    ${id}: ${blocks[id]},`).join('\n')
  return `export const TEST_BLOCKS: Record<number, number> = {\n${body}\n} as const\n`
}

async function main() {
  const { workingUrls, testBlocks } = await probeEndpoints()

  const testBlocksPath = resolve(__dirname, '..', 'src', 'test-blocks.ts')
  writeFileSync(testBlocksPath, formatTestBlocks(testBlocks))
  console.log(`Probe: wrote ${Object.keys(testBlocks).length} test blocks to ${testBlocksPath}`)

  const rpcUrlsPath = resolve(__dirname, '..', 'src', 'generated', 'rpcUrls.json')
  writeFileSync(rpcUrlsPath, JSON.stringify(workingUrls, null, 2) + '\n')
  console.log(`Probe: written to ${rpcUrlsPath}`)
  process.exit(0)
}

main().catch((e) => {
  console.error('Probe failed:', e)
  process.exit(1)
})
