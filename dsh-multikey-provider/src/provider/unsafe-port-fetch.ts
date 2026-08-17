import http from 'node:http'
import https from 'node:https'
import type { IncomingHttpHeaders, RequestOptions } from 'node:http'

const UNSAFE_PORT = '6666'
type FetchImplementation = typeof globalThis.fetch

function responseHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers()
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue
    result.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return result
}

/**
 * Fetch implementation for the loopback port that the WHATWG fetch port
 * blocklist rejects before opening a socket.
 * @param input - request URL or Request.
 * @param init - fetch request options.
 * @returns a streaming Response with the Node HTTP response body.
 */
export function fetchUnsafePort(input: Parameters<FetchImplementation>[0], init?: Parameters<FetchImplementation>[1]): ReturnType<FetchImplementation> {
  const request = input instanceof Request ? input : undefined
  const url = new URL(request?.url ?? String(input))
  const options: RequestOptions = {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: `${url.pathname}${url.search}`,
    method: init?.method ?? request?.method ?? 'GET',
    headers: Object.fromEntries(new Headers(init?.headers ?? request?.headers).entries()),
  }
  const body = init?.body ?? request?.body
  const signal = init?.signal ?? request?.signal
  const transport = url.protocol === 'https:' ? https : http

  return new Promise<Response>((resolve, reject) => {
    const client = transport.request(options, response => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          response.on('data', chunk => controller.enqueue(new Uint8Array(chunk)))
          response.on('end', () => controller.close())
          response.on('error', error => controller.error(error))
        },
        cancel() {
          response.destroy()
        },
      })
      resolve(new Response(stream, {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: responseHeaders(response.headers),
      }))
    })
    client.on('error', reject)
    if (signal !== undefined) {
      if (signal.aborted) {
        client.destroy(signal.reason)
        reject(signal.reason)
      } else {
        signal.addEventListener('abort', () => client.destroy(signal.reason), { once: true })
      }
    }
    if (body !== null && body !== undefined) {
      if (typeof body === 'string' || body instanceof Uint8Array) client.write(body)
      else void new Response(body).arrayBuffer().then(value => client.write(new Uint8Array(value)))
    }
    client.end()
  })
}

/** Install the transport once for all pi-ai OpenAI clients in this plugin. */
export function installUnsafePortFetch(): void {
  const nativeFetch = globalThis.fetch
  if (nativeFetch === undefined || (nativeFetch as { __dshUnsafePortFetch?: boolean }).__dshUnsafePortFetch === true) return
  const fetch = ((input: Parameters<FetchImplementation>[0], init?: Parameters<FetchImplementation>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.protocol === 'http:' && url.port === UNSAFE_PORT) return fetchUnsafePort(input, init)
    return nativeFetch(input, init)
  }) as FetchImplementation & { __dshUnsafePortFetch?: boolean }
  fetch.__dshUnsafePortFetch = true
  globalThis.fetch = fetch
}
