/**
 * Body helpers.
 *
 * labsvc parses every request body as a raw Buffer, because the proxies must forward
 * bytes verbatim. Routes that want structured input opt in here.
 */

import type {FastifyRequest} from 'fastify'

export function rawBody(req: FastifyRequest): Buffer {
    const body = req.body
    if (Buffer.isBuffer(body)) {
        return body
    }
    if (typeof body === 'string') {
        return Buffer.from(body, 'utf8')
    }
    // Defensive: should not happen while the catch all buffer parser is installed, but a
    // silently empty body is a miserable thing to debug, so re-encode rather than drop.
    if (body !== null && body !== undefined) {
        return Buffer.from(JSON.stringify(body), 'utf8')
    }
    return Buffer.alloc(0)
}

export function jsonBody<T>(req: FastifyRequest, fallback: T): T {
    const raw = rawBody(req)
    if (raw.length === 0) {
        return fallback
    }
    try {
        return JSON.parse(raw.toString('utf8')) as T
    } catch {
        return fallback
    }
}
