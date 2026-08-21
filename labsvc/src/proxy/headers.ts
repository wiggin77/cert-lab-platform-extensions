/**
 * Header handling for both proxies.
 *
 * This lives in one module on purpose. The rules below were previously duplicated in
 * inbound.ts and outbound.ts, and a missing entry in one copy corrupted every response the
 * outbound proxy relayed.
 */

/**
 * Never forwarded to the next hop in either direction.
 *
 * content-length is included because both proxies may rewrite a body (the inbound proxy
 * rewrites response_url, which changes its length). undici recomputes it.
 */
const HOP_BY_HOP = new Set([
    'host',
    'content-length',
    'connection',
    'keep-alive',
    'transfer-encoding',
    'upgrade',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
])

/**
 * Additionally stripped when relaying a RESPONSE back to the caller.
 *
 * fetch decodes the upstream body transparently, so by the time we relay it the bytes are
 * plain. Passing the upstream's content-encoding along tells the caller to inflate
 * plaintext, which fails with Z_DATA_ERROR and surfaces as an unhelpful "terminated".
 *
 * That bug is why the Module 3 escalation silently stopped working the moment the
 * handler's REST calls were routed through the proxy: every response it read was
 * unreadable, so the handler threw before it could post anything.
 */
const RESPONSE_ONLY_STRIP = new Set(['content-encoding'])

function flatten(headers: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
        out[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
    }
    return out
}

/** Headers safe to send on to the next hop with a request. */
export function forwardableHeaders(headers: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(flatten(headers))) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) {
            out[k] = v
        }
    }
    return out
}

/** Headers safe to relay back to the original caller with a decoded response body. */
export function relayableHeaders(headers: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
        const key = k.toLowerCase()
        if (!HOP_BY_HOP.has(key) && !RESPONSE_ONLY_STRIP.has(key)) {
            out[k] = v
        }
    }
    return out
}

export {flatten as flattenHeaders}
