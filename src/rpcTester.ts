import { FetchRequest, JsonRpcProvider, Network } from 'ethers'
import { TEST_BLOCKS } from "./test-blocks";
import { DID_EVENT_TOPICS } from './shared.js'

export type RpcTestResult = {
  chainId: number
  url: string
  ok: boolean
  latencyMs: number
}

export async function testRpcUrl(
  chainId: number,
  url: string,
  registry: string,
  timeout = 5_000,
  testBlocks?: Record<number, number>,
): Promise<RpcTestResult> {
  const req = new FetchRequest(url)
  req.timeout = timeout
  const provider = new JsonRpcProvider(req, chainId, {
    staticNetwork: Network.from(chainId),
  })

  const start = performance.now()

  try {
    await provider.send('eth_blockNumber', [])
    const latencyMs = performance.now() - start

    const blocks = testBlocks ?? TEST_BLOCKS
    const testBlock = blocks[chainId]
    if (!testBlock || testBlock <= 0) {
      provider.destroy?.()
      return { chainId, url, ok: false, latencyMs }
    }

    try {
      const logs = await provider.send('eth_getLogs', [
        {
          address: registry.toLowerCase(),
          fromBlock: `0x${testBlock.toString(16)}`,
          toBlock: `0x${testBlock.toString(16)}`,
          topics: [DID_EVENT_TOPICS],
        },
      ])
      if (!Array.isArray(logs) || logs.length === 0) {
        provider.destroy?.()
        return { chainId, url, ok: false, latencyMs }
      }
    } catch {
      provider.destroy?.()
      return { chainId, url, ok: false, latencyMs }
    }

    provider.destroy?.()
    return { chainId, url, ok: true, latencyMs }
  } catch {
    const latencyMs = performance.now() - start
    provider.destroy?.()
    return { chainId, url, ok: false, latencyMs }
  }
}
