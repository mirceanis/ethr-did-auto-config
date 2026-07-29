#!/usr/bin/env node
import {getResolver} from 'ethr-did-resolver'
import {ethrAutoConfig} from '../autoConfig.js'
import {Resolver} from 'did-resolver'

const resolver = new Resolver(getResolver(ethrAutoConfig()))

async function main() {
    const did = process.argv[2]
    if (!did) {
        console.error('Usage: resolve <did>')
        process.exit(1)
    }

    const result = await resolver.resolve(did)
    const output = {
        did, result
    }
    console.log(JSON.stringify(output, null, 2))
}

main().catch((e) => {
    console.error('Resolve failed:', e)
    process.exit(1)
})
