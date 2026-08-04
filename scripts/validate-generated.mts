import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ROOT = resolve(__dirname, '..')
const urls = JSON.parse(readFileSync(resolve(ROOT, 'src/generated/rpcUrls.json'), 'utf8'))

for (const [cid, arr] of Object.entries(urls)) {
  if (!/^[0-9]+$/.test(cid)) throw new Error('bad chainId: ' + cid)
  if (!Array.isArray(arr)) throw new Error('chain ' + cid + ' is not an array')
  const seen = new Set()
  for (const u of arr) {
    if (typeof u !== 'string' || !u.startsWith('https://')) throw new Error('bad url: ' + u)
    if (seen.has(u)) throw new Error('duplicate url: ' + u)
    seen.add(u)
  }
}

const testBlocks = JSON.parse(readFileSync(resolve(ROOT, 'src/test-blocks.json'), 'utf8'))
for (const [cid, block] of Object.entries(testBlocks)) {
  if (!/^[0-9]+$/.test(cid)) throw new Error('bad chainId: ' + cid)
  if (typeof block !== 'number' || !Number.isInteger(block) || block <= 0) {
    throw new Error('bad test block for chain ' + cid + ': ' + block)
  }
}

console.log('generated files OK')
