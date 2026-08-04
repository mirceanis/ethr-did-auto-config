import { deployments } from 'ethr-did-resolver'
import { id } from 'ethers'

const DID_OWNER_CHANGED = id('DIDOwnerChanged(address,address,uint256)')
const DID_DELEGATE_CHANGED = id('DIDDelegateChanged(address,bytes32,address,uint256,uint256)')
const DID_ATTRIBUTE_CHANGED = id('DIDAttributeChanged(address,bytes32,bytes,uint256,uint256)')
export const DID_EVENT_TOPICS = [DID_OWNER_CHANGED, DID_DELEGATE_CHANGED, DID_ATTRIBUTE_CHANGED]

export function getRegistry(chainId: number): string {
  return deployments.find((d) => Number(d.chainId) === chainId)?.registry ?? ''
}

export function trackingRank(t: string | undefined): number {
  return t === 'none' ? 0 : t === 'limited' ? 1 : 2
}
