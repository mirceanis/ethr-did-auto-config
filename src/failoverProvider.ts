import { JsonRpcProvider } from 'ethers'
import type { FetchRequest } from 'ethers'

const RETRIABLE_CODES = new Set(['NETWORK_ERROR', 'SERVER_ERROR', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'])

function isRetriableError(err: any): boolean {
    if (RETRIABLE_CODES.has(err.code)) return true
    if (typeof err.code === 'number' && err.code <= -32000 && err.code >= -32099) return true
    if (err.code === -32603) return true
    if (err.code === 4444) return true
    if (err.code === 'CALL_EXCEPTION' && err.data == null) return true
    if (err.code === 'UNKNOWN_ERROR') return true
    return false
}

function isHistoricalBlockRange(params: any[]): boolean {
    const filter = params?.[0]
    if (!filter) return false
    const toBlock = filter.toBlock
    return !(!toBlock || toBlock === 'latest' || toBlock === 'pending' || toBlock === 'earliest')
}

export class FailoverProvider extends JsonRpcProvider {
    #providers: JsonRpcProvider[]

    get rpcUrls(): string[] {
        return this.#providers.map((p) => (p as any)._getConnection().url)
    }

    constructor(url: string | FetchRequest, providers: JsonRpcProvider[], chainId: number, options?: any) {
        if (!providers?.length) throw new Error('FailoverProvider requires at least one provider')
        super(url, chainId, { staticNetwork: true, ...options })
        this.#providers = providers
    }

    async send(method: string, params: any[]): Promise<any> {
        let lastError: any
        for (const provider of this.#providers) {
            try {
                const result = await provider.send(method, params)
                if (method === 'eth_getLogs' && Array.isArray(result) && result.length === 0) {
                    if (isHistoricalBlockRange(params)) {
                        lastError = Object.assign(new Error('empty historical logs'), { code: 'EMPTY_HISTORICAL' })
                        continue
                    }
                }
                return result
            } catch (err: any) {
                if (isRetriableError(err)) {
                    lastError = err
                    continue
                }
                throw err
            }
        }
        throw lastError
    }
}

export function buildFailoverProvider(chainId: number, rpcUrls: string[]): FailoverProvider {
    const providers = rpcUrls.map((url) => new JsonRpcProvider(url, chainId, { staticNetwork: true }))
    return new FailoverProvider(rpcUrls[0], providers, chainId)
}
