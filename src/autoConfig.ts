import { deployments } from 'ethr-did-resolver'
import { buildFailoverProvider } from './failoverProvider.js'
import rpcUrls from './generated/rpcUrls.json' with { type: 'json' }

export type AutoConfigOptions = {
  rpcUrls?: Record<number, string[]>
}

export function ethrAutoConfig(options: AutoConfigOptions = {}) {
  const workingUrls = options.rpcUrls ?? (rpcUrls as Record<number, string[]>)

  const networks = deployments
    .filter((d) => {
      const cid = Number(d.chainId)
      return workingUrls[cid]?.length
    })
    .map((d) => {
      const cid = Number(d.chainId)
      return {
        chainId: cid,
        name: d.name ?? '',
        registry: d.registry,
        legacyNonce: d.legacyNonce ?? false,
        provider: buildFailoverProvider(cid, workingUrls[cid]),
      }
    })

  return { networks }
}
