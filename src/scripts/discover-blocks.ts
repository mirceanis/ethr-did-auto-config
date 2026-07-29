#!/usr/bin/env node
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { discoverBlocks } from '../discover-blocks'
import { formatTestBlocks } from '../shared.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

async function main() {
  const updated = await discoverBlocks()
  const outPath = resolve(__dirname, '..', 'test-blocks.ts')
  writeFileSync(outPath, formatTestBlocks(updated))
  console.log(`Discover: wrote ${Object.keys(updated).length} entries to ${outPath}`)
}

main().catch((e) => {
  console.error('Discover failed:', e)
  process.exit(1)
})
