#!/usr/bin/env node
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { discoverBlocks } from '../discover-blocks'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function formatTestBlocks(blocks: Record<number, number>): string {
  const chainIds = Object.keys(blocks).map(Number).sort((a, b) => a - b)
  const body = chainIds.map((id) => `    ${id}: ${blocks[id]},`).join('\n')
  return `export const TEST_BLOCKS: Record<number, number> = {\n${body}\n} as const\n`
}

async function main() {
  const updated = await discoverBlocks()
  const outPath = resolve(__dirname, '..', 'src', 'test-blocks.ts')
  writeFileSync(outPath, formatTestBlocks(updated))
  console.log(`Discover: wrote ${Object.keys(updated).length} entries to ${outPath}`)
}

main().catch((e) => {
  console.error('Discover failed:', e)
  process.exit(1)
})
