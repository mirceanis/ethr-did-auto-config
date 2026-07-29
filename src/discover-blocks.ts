import { deployments } from 'ethr-did-resolver'
import { FetchRequest, JsonRpcProvider, Network, id } from 'ethers'
import { fetchRpcUrls, RpcCandidate } from './chainlist.js'
import { TEST_BLOCKS as EXISTING_TEST_BLOCKS } from './test-blocks.js'

const RPC_TIMEOUT = 10_000
const MAX_RETRIES = 3

const DID_OWNER_CHANGED = id('DIDOwnerChanged(address,address,uint256)')
const DID_DELEGATE_CHANGED = id('DIDDelegateChanged(address,bytes32,address,uint256,uint256)')
const DID_ATTRIBUTE_CHANGED = id('DIDAttributeChanged(address,bytes32,bytes,uint256,uint256)')
const DID_EVENT_TOPICS = [DID_OWNER_CHANGED, DID_DELEGATE_CHANGED, DID_ATTRIBUTE_CHANGED]

function getRegistry(chainId: number): string {
  return deployments.find((d) => Number(d.chainId) === chainId)?.registry ?? ''
}

function createProvider(url: string, chainId: number): JsonRpcProvider {
  const req = new FetchRequest(url)
  req.timeout = RPC_TIMEOUT
  return new JsonRpcProvider(req, chainId, {
    staticNetwork: Network.from(chainId),
  })
}

function isNonRetriable(err: any): boolean {
  if (!err) return false
  const code = err.code ?? ''
  const msg = String(err.message ?? '').toLowerCase()
  if (code === 'TIMEOUT' || msg.includes('timeout')) return true
  if (code === 'SERVER_ERROR' && msg.includes('enotfound')) return true
  if (msg.includes('enotfound') || msg.includes('getaddrinfo')) return true
  return false
}

function isRangeError(err: any): boolean {
  if (err.code === 4444) return true
  if (err.code === -32005) return true
  if (err.code === -32000) {
    const msg = (err.message ?? '').toLowerCase()
    return (
      msg.includes('range') ||
      msg.includes('more than') ||
      msg.includes('results') ||
      msg.includes('limit') ||
      msg.includes('too many') ||
      msg.includes('exceeds')
    )
  }
  return false
}

async function bisectDeployBlock(
  provider: JsonRpcProvider,
  registry: string,
  low: number,
  high: number,
  log = '',
): Promise<number | null> {
  let iterations = 0
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    iterations++
    try {
      const code = await provider.send('eth_getCode', [registry, `0x${mid.toString(16)}`])
      if (code && code !== '0x') {
        console.log(`${log}    bisect [${low}, ${high}] mid=${mid} -> contract EXISTS, narrowing high`)
        high = mid
      } else {
        console.log(`${log}    bisect [${low}, ${high}] mid=${mid} -> no contract, advancing low`)
        low = mid + 1
      }
    } catch (err) {
      if (isNonRetriable(err)) throw err
      console.log(`${log}    bisect [${low}, ${high}] mid=${mid} -> RPC error, abandoning bisection`)
      return null
    }
  }
  console.log(`${log}    bisect converged on block ${low} after ${iterations} iteration(s), verifying...`)
  try {
    const code = await provider.send('eth_getCode', [registry, `0x${low.toString(16)}`])
    if (code && code !== '0x') {
      console.log(`${log}    verified block ${low}: contract exists`)
      return low
    }
    console.log(`${log}    verification failed: block ${low} has no code`)
  } catch (err) {
    if (isNonRetriable(err)) throw err
    console.log(`${log}    verification RPC error at block ${low}`)
  }
  return null
}

async function findFirstEventBlock(
  provider: JsonRpcProvider,
  registry: string,
  low: number,
  high: number,
  topics?: string[],
  log = '',
): Promise<number | null> {
  let iterations = 0
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    iterations++
    try {
      const params: any = {
        address: registry.toLowerCase(),
        fromBlock: `0x${mid.toString(16)}`,
        toBlock: `0x${mid.toString(16)}`,
      }
      if (topics) params.topics = [topics]
      const logs = await provider.send('eth_getLogs', [params])
      if (Array.isArray(logs) && logs.length > 0) {
        console.log(`${log}    bisect [${low}, ${high}] mid=${mid} -> ${logs.length} event(s) FOUND, narrowing high`)
        high = mid
      } else {
        console.log(`${log}    bisect [${low}, ${high}] mid=${mid} -> 0 events, advancing low`)
        low = mid + 1
      }
    } catch (err: any) {
      if (isNonRetriable(err)) throw err
      console.log(`${log}    bisect [${low}, ${high}] mid=${mid} -> error, abandoning bisection`)
      return null
    }
  }
  console.log(`${log}    bisect converged on block ${low} after ${iterations} iteration(s), verifying...`)
  try {
    const params: any = {
      address: registry.toLowerCase(),
      fromBlock: `0x${low.toString(16)}`,
      toBlock: `0x${low.toString(16)}`,
    }
    if (topics) params.topics = [topics]
    const logs = await provider.send('eth_getLogs', [params])
    if (Array.isArray(logs) && logs.length > 0) {
      console.log(`${log}    verified block ${low}: ${logs.length} event(s)`)
      return low
    }
    console.log(`${log}    verification failed: block ${low} returned 0 events`)
  } catch (err: any) {
    if (isNonRetriable(err)) throw err
    console.log(`${log}    verification RPC error at block ${low}`)
  }
  return null
}

async function findDidEventBlock(
  provider: JsonRpcProvider,
  registry: string,
  fromBlock: number,
  toBlock: number,
  log = '',
): Promise<number | null> {
  return findFirstEventBlock(provider, registry, fromBlock, toBlock, DID_EVENT_TOPICS, log)
}

async function discoverBlockForChain(
  chainId: number,
  registry: string,
  candidates: RpcCandidate[],
  log: string,
): Promise<number | null> {
  let deployBlock: number | null = null
  type Entry = { candidate: RpcCandidate; retries: number }
  const queue: Entry[] = candidates.map((c) => ({ candidate: c, retries: 0 }))

  while (queue.length > 0) {
    const { candidate, retries } = queue.shift()!
    const label = retries > 0 ? ` (retry ${retries}/${MAX_RETRIES})` : ''
    console.log(`${log}  trying RPC ${candidate.url}${label}`)
    const provider = createProvider(candidate.url, chainId)

    const requeue = () => {
      if (retries < MAX_RETRIES) {
        queue.push({ candidate, retries: retries + 1 })
      }
    }

    try {
      const blockNumHex = await provider.send('eth_blockNumber', [])
      const currentBlock = Number(blockNumHex)
      if (!currentBlock || currentBlock <= 0) {
        console.log(`${log}  eth_blockNumber returned invalid value ${blockNumHex}, dropping URL`)
        continue
      }
      console.log(`${log}  current block = ${currentBlock}`)

      if (deployBlock === null) {
        console.log(`${log}  phase 1/2: binary searching for registry deploy block in [0, ${currentBlock}]`)
        deployBlock = await bisectDeployBlock(provider, registry, 0, currentBlock, log)
        if (deployBlock === null) {
          console.log(`${log}  phase 1 failed: could not find deployment block`)
          requeue()
          continue
        }
        console.log(`${log}  phase 1 complete: first registry event at block ${deployBlock}`)
      } else {
        console.log(`${log}  reuse previous deploy block ${deployBlock}, skipping phase 1`)
      }

      console.log(`${log}  phase 2/2: searching for DID events from block ${deployBlock} to ${currentBlock}`)
      const didBlock = await findDidEventBlock(provider, registry, deployBlock, currentBlock, log)
      if (didBlock !== null) {
        console.log(`${log}  phase 2 complete: DID event block = ${didBlock}`)
        return didBlock
      }
      console.log(`${log}  phase 2 failed: no DID events found in range`)
      requeue()
    } catch (err) {
      if (isNonRetriable(err)) {
        console.log(`${log}  non-retriable error on ${candidate.url}, dropping: ${err}`)
      } else {
        console.log(`${log}  error on ${candidate.url}${retries < MAX_RETRIES ? ', re-queueing' : ', dropping'}: ${err}`)
        requeue()
      }
    } finally {
      provider.destroy?.()
    }
  }
  return null
}

export async function discoverBlocks(): Promise<Record<number, number>> {
  const existing: Record<number, number> = { ...EXISTING_TEST_BLOCKS }

  const deploymentChains = deployments.map((d) => Number(d.chainId))
  const newChains = deploymentChains.filter((id) => !(id in existing))

  if (newChains.length === 0) return existing

  console.log(`Discover: ${newChains.length} new network(s) without TEST_BLOCKS`)
  for (const id of newChains) {
    const name = deployments.find((d) => Number(d.chainId) === id)?.name ?? '?'
    console.log(`  chain ${id} (${name})`)
  }

  const candidates = await fetchRpcUrls(newChains)

  const newBlocks: Record<number, number> = {}
  for (const chainId of newChains) {
    const name = deployments.find((d) => Number(d.chainId) === chainId)?.name ?? '?'
    const log = `[${chainId} ${name}]`

    const registry = getRegistry(chainId)
    if (!registry) {
      console.log(`${log} SKIP: no registry address`)
      continue
    }
    const chainCandidates = candidates[chainId] ?? []
    if (chainCandidates.length === 0) {
      console.log(`${log} SKIP: no RPC candidates`)
      continue
    }

    console.log(`${log} Starting discovery (registry=${registry})`)
    const block = await discoverBlockForChain(chainId, registry, chainCandidates, log)
    if (block !== null) {
      console.log(`${log} FOUND block ${block}`)
      newBlocks[chainId] = block
    } else {
      console.log(`${log} FAILED all RPC URLs`)
    }
  }

  if (Object.keys(newBlocks).length === 0) {
    console.log('Discover: no new blocks discovered')
    return existing
  }

  const updated: Record<number, number> = { ...existing, ...newBlocks }
  return updated
}
