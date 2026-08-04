import {deployments} from 'ethr-did-resolver'
import {FetchRequest, JsonRpcProvider, Network} from 'ethers'
import {fetchRpcUrls, RpcCandidate} from './chainlist.js'
import EXISTING_TEST_BLOCKS from './test-blocks.json'
import {DID_EVENT_TOPICS, getRegistry} from './shared.js'

const RPC_TIMEOUT = 10_000

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
  candidates: RpcCandidate[],
  registry: string,
  chainId: number,
  deployBlock: number,
  high: number,
  topics?: string[],
  log = '',
): Promise<number | null> {
  let offset = deployBlock
  let chunkSize = 10_000

  for (const candidate of candidates) {
    const provider = createProvider(candidate.url, chainId)
    let isArchival = false
    let lastOkSize = 10_000
    console.log(`${log}  scanning RPC ${candidate.url} from block ${offset}`)

    while (offset <= high) {
      const toBlock = Math.min(offset + chunkSize - 1, high)
      try {
        const params: any = {
          address: registry.toLowerCase(),
          fromBlock: `0x${offset.toString(16)}`,
          toBlock: `0x${toBlock.toString(16)}`,
        }
        if (topics) params.topics = [topics]
        const logs = await provider.send('eth_getLogs', [params])
        if (Array.isArray(logs) && logs.length > 0) {
          const blockNumbers = logs.map((l: any) => Number(l.blockNumber))
          const minBlock = Math.min(...blockNumbers)
          console.log(`${log}    found ${logs.length} event(s) at block ${minBlock} [chunkSize=${chunkSize}]`)
          return minBlock
        }
        isArchival = true
        lastOkSize = chunkSize
        offset = toBlock + 1
        chunkSize = Math.min(chunkSize * 2, 200_000)
      } catch (err: any) {
        if (isNonRetriable(err)) throw err
        if (isArchival && chunkSize > lastOkSize) {
          chunkSize = lastOkSize
          console.log(`${log}    error, backing off chunkSize to ${chunkSize}`)
          continue
        }
        console.log(`${log}    error, moving to next RPC at offset ${offset}`)
        break
      }
    }
    provider.destroy?.()
    chunkSize = 10_000
  }
  return null
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
        console.log(`${log}  eth_blockNumber returned invalid value, dropping`)
        continue
      }

      console.log(`${log}  phase 1: binary searching for registry deploy block in [0, ${currentBlock}]`)
      const deployBlock = await bisectDeployBlock(provider, registry, 0, currentBlock, log)
      if (deployBlock === null) {
        console.log(`${log}  phase 1 failed`)
        continue
      }
      console.log(`${log}  phase 1 complete: deploy block = ${deployBlock}`)

      console.log(`${log}  phase 2: chunked scanning for DID events from ${deployBlock} to ${currentBlock}`)
      const didBlock = await findFirstEventBlock(candidates, registry, chainId, deployBlock, currentBlock, DID_EVENT_TOPICS, log)
      if (didBlock !== null) {
        console.log(`${log}  phase 2 complete: DID event block = ${didBlock}`)
        return didBlock
      }
      console.log(`${log}  phase 2 exhausted all candidates`)
      return null
    } catch (err) {
      if (isNonRetriable(err)) {
        console.log(`${log}  non-retriable error, dropping: ${err}`)
      } else {
        console.log(`${log}  error, skipping: ${err}`)
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

  return {...existing, ...newBlocks}
}
