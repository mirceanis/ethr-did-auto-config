# ethr-did-auto-config

Self-adjusting configuration for ethr-did-resolver using public RPC endpoints.

## Usage

```ts
import {ethrAutoConfig} from 'ethr-did-auto-config'
import {getResolver} from 'ethr-did-resolver'

const resolver = getResolver(ethrAutoConfig())
```

By default, it uses an auto-curated list of JSON-RPC endpoints
from [DefiLlama/chainlist](https://github.com/DefiLlama/chainlist) against the known deployments of the
ethr-did-registry.
You can also override which RPC URLs to use per chain:

```ts
ethrAutoConfig({rpcUrls: {1: ['https://my-eth-node.example.com']}})
```

Use multiple URLs to increase resilience. Internally, it creates a `FailoverProvider` that tries each URL in sequence on
failure.

## API

### `ethrAutoConfig(options?)`

Main entry. Returns `{ networks }` for ethr-did-resolver.

Reads `generated/rpcUrls.json` by default. Each chain gets a `FailoverProvider` that cycles through its RPC URLs — if
one fails, the next is tried automatically.

### `probeEndpoints()`

Probes all known chains in parallel. For each chain:

1. If no test block exists, runs **discovery** (binary search for deploy block + first DID event).
2. Tests every RPC candidate (sends `eth_getLogs` at the test block).
3. Returns `{ workingUrls, testBlocks }` — sorted by tracking policy then latency.

```ts
import {probeEndpoints} from 'ethr-did-auto-config'

const result = await probeEndpoints()
```

### `discoverBlocks()`

Runs discovery for chains that don't yet have a test block. For each new chain:

- **Phase 1:** Binary search (`eth_getCode`) to find the registry deploy block.
- **Phase 2:** Binary search (`eth_getLogs` at single blocks) to find the first DID event.

Uses a retry queue (max 3 per URL). Timeouts and DNS failures are dropped immediately.

Returns `Record<number, number>` — all test blocks (existing + new).

### `fetchRpcUrls(chainIds)`

Fetches RPC candidates from [DefiLlama/chainlist](https://github.com/DefiLlama/chainlist). Returns
`Record<number, RpcCandidate[]>`.

### `testRpcUrl(chainId, url, registry, timeout?, testBlocks?)`

Tests a single RPC URL by sending `eth_blockNumber` then `eth_getLogs` at the chain's test block. Returns
`RpcTestResult`.

### `FailoverProvider` / `buildFailoverProvider(chainId, urls)`

A `JsonRpcProvider` subclass that tries each URL in sequence on failure. Skips past URLs that return empty logs for
historical queries (indicating limited archival access).

## CLI Scripts

```sh
pnpm probe            # probeEndpoints() + write test-blocks.ts + rpcUrls.json
pnpm discover-blocks  # discoverBlocks() + write test-blocks.ts
```

Generated files are checked in so consumers don't need to probe at install time. Re-run `pnpm probe` periodically to
refresh URLs.
