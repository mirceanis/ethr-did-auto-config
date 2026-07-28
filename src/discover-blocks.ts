import { deployments } from 'ethr-did-resolver'
import { FetchRequest, JsonRpcProvider, Network, id } from 'ethers'
import { fetchRpcUrls, RpcCandidate } from './chainlist.js'
import { TEST_BLOCKS as EXISTING_TEST_BLOCKS } from './test-blocks.js'

const RPC_TIMEOUT = 10_000

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
  } catch {
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
  console.log(`${log}    event scan range [${low}, ${high}]`)
  try {
    const params: any = {
      address: registry.toLowerCase(),
      fromBlock: `0x${low.toString(16)}`,
      toBlock: `0x${high.toString(16)}`,
    }
    if (topics) params.topics = [topics]
    const logs = await provider.send('eth_getLogs', [params])
    if (Array.isArray(logs) && logs.length > 0) {
      const firstBlock = Number(logs[0].blockNumber)
      console.log(`${log}    range [${low}, ${high}] returned ${logs.length} event(s), first at block ${firstBlock}`)
      return firstBlock
    }
    console.log(`${log}    range [${low}, ${high}] returned 0 events`)
    return null
  } catch (err: any) {
    if (!isRangeError(err)) {
      console.log(`${log}    range [${low}, ${high}] non-range error (code=${err.code}), dropping URL`)
      return null
    }
    console.log(`${log}    range [${low}, ${high}] hit range error (code=${err.code}): halving`)
    if (low >= high) {
      console.log(`${log}    range too small to halve further, dropping URL`)
      return null
    }
    const mid = Math.floor((low + high) / 2)
    console.log(`${log}    halving to [${low}, ${mid}] and [${mid + 1}, ${high}]`)
    const left = await findFirstEventBlock(provider, registry, low, mid, topics, log)
    if (left !== null) return left
    return await findFirstEventBlock(provider, registry, mid + 1, high, topics, log)
  }
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
  for (const candidate of candidates) {
    console.log(`${log}  trying RPC ${candidate.url}`)
    const provider = createProvider(candidate.url, chainId)
    try {
      const blockNumHex = await provider.send('eth_blockNumber', [])
      const currentBlock = Number(blockNumHex)
      if (!currentBlock || currentBlock <= 0) {
        console.log(`${log}  eth_blockNumber returned invalid value ${blockNumHex}, dropping URL`)
        continue
      }
      console.log(`${log}  current block = ${currentBlock}`)

      console.log(`${log}  phase 1/2: binary searching for registry deploy block in [0, ${currentBlock}]`)
      const firstBlock = await bisectDeployBlock(provider, registry, 0, currentBlock, log)
      if (firstBlock === null) {
        console.log(`${log}  phase 1 failed: could not find deployment block, dropping URL`)
        continue
      }
      console.log(`${log}  phase 1 complete: first registry event at block ${firstBlock}`)

      console.log(`${log}  phase 2/2: searching for DID events from block ${firstBlock} to ${currentBlock}`)
      const didBlock = await findDidEventBlock(provider, registry, firstBlock, currentBlock, log)
      if (didBlock !== null) {
        console.log(`${log}  phase 2 complete: DID event block = ${didBlock}`)
        return didBlock
      }
      console.log(`${log}  phase 2 failed: no DID events found in range, dropping URL`)
    } catch (err) {
      console.log(`${log}  unexpected error on ${candidate.url}, dropping URL: ${err}`)
      continue
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
