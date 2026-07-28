import { JsonRpcProvider, Network, FetchRequest } from 'ethers'

export const TEST_BLOCKS: Record<number, number> = {
  1: 7049729,
  11155111: 4907882,
  17000: 2590658,
  100: 45566242,
  246: 15358884,
  73799: 2003299,
  137: 24190361,
  1313161554: 57701343,
}

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

    const testBlock = TEST_BLOCKS[chainId]
    if (testBlock && testBlock > 0) {
      try {
        const logs = await provider.send('eth_getLogs', [
          {
            address: registry.toLowerCase(),
            fromBlock: `0x${testBlock.toString(16)}`,
            toBlock: `0x${testBlock.toString(16)}`,
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
    }

    provider.destroy?.()
    return { chainId, url, ok: true, latencyMs }
  } catch {
    const latencyMs = performance.now() - start
    provider.destroy?.()
    return { chainId, url, ok: false, latencyMs }
  }
}
