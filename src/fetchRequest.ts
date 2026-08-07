import http from 'http'
import https from 'https'
import { FetchRequest } from 'ethers'

/**
 * Why this exists:
 *
 * Ethers' built-in getUrlFunc constructs the request with
 * `http.request(url, { method, headers })` and then calls
 * `request.setTimeout(req.timeout)`. Per Node docs, `request.setTimeout`
 * only arms the socket timer **after the socket has connected** -- so a
 * connection that stalls during TCP/TLS establishment ends up with NO armed
 * timeout, and Node then falls back to its own ~5s connect deadline. The
 * result is that every ethers request which hangs during connect dies at
 * ~5s regardless of what `req.timeout` is set to (5s, 10s, 30s, ...).
 */

const agents = new Map<string, http.Agent>()

function agentFor(scheme: string, timeout: number): http.Agent {
  const key = `${scheme}:${timeout}`
  let agent = agents.get(key)
  if (!agent) {
    agent =
      scheme === 'https:'
        ? new https.Agent({ timeout })
        : new http.Agent({ timeout })
    agents.set(key, agent)
  }
  return agent
}

/**
 * Create a FetchRequest whose timeout is honoured from the very start of the
 * connection (including DNS/connect/TLS), not only after connect.
 */
export function createFetchRequest(url: string, timeout: number): FetchRequest {
  const request = new FetchRequest(url)
  request.timeout = timeout
  const scheme = url.split(':')[0].toLowerCase() + ':'
  request.getUrlFunc = FetchRequest.createGetUrlFunc({ agent: agentFor(scheme, timeout) })
  return request
}