/**
 * Outbound recording proxy: the learner's handler -> labsvc -> Mattermost.
 *
 * Deliberately transparent. The learner still reads process.env.MM_BOT_TOKEN and sets the
 * Authorization header themselves, exactly as they would in production. labsvc forwards
 * verbatim and only observes. No credential injection, no request shaping.
 *
 * A learner who ignores MM_URL and talks to Mattermost directly still passes every check,
 * because the grader reads Mattermost state as the source of truth. They just get worse
 * hints. See DESIGN.md section 4.1.
 */

import {randomUUID} from 'node:crypto'
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify'

import {config} from '../config.js'
import type {CapturedMessage} from '../types.js'
import {rawBody} from '../util/body.js'
import type {Journal} from './journal.js'

const HOP_BY_HOP = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'])

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** Routes worth annotating in the inspector, because a lab step depends on them. */
const NOTABLE: Array<{test: RegExp; note: string; module: number}> = [
    {test: /^\/api\/v4\/posts$/, note: 'Creating a post', module: 3},
    {test: /^\/api\/v4\/actions\/dialogs\/open$/, note: 'Opening an interactive dialog', module: 5},
    {test: /^\/api\/v4\/posts\/[a-z0-9]+$/, note: 'Reading or updating a post', module: 3},
    {test: /^\/api\/v4\/channels\/[a-z0-9]+\/posts$/, note: 'Reading channel posts', module: 3},
]

function flattenHeaders(headers: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
        out[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
    }
    return out
}

function forwardableHeaders(headers: Record<string, unknown>): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
        if (HOP_BY_HOP.has(k.toLowerCase())) {
            continue
        }
        out[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
    }
    return out
}

function capture(headers: Record<string, unknown>, body: unknown, extra: Partial<CapturedMessage> = {}): CapturedMessage {
    let value = body
    let truncated = false
    const encoded = JSON.stringify(body) ?? ''
    if (encoded.length > config.journal.maxBodyBytes) {
        value = {__truncated: `${encoded.slice(0, config.journal.maxBodyBytes)}...`}
        truncated = true
    }
    return {headers: flattenHeaders(headers), body: value, truncated: truncated || undefined, ...extra}
}

function safeJson(text: string): unknown {
    if (!text) {
        return null
    }
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

export type OutboundDeps = {
    journal: Journal
}

export function registerOutboundProxy(app: FastifyInstance, deps: OutboundDeps): void {
    app.route({
        method: [...METHODS],
        url: '/mm/*',
        handler: async (req, reply) => proxyToMattermost(req, reply, deps),
    })
}

async function proxyToMattermost(req: FastifyRequest, reply: FastifyReply, deps: OutboundDeps): Promise<FastifyReply> {
    const correlationId = (req.headers['x-lab-correlation-id'] as string | undefined) ?? randomUUID()

    // /mm/api/v4/posts -> /api/v4/posts
    const suffix = req.url.replace(/^\/mm/, '')
    const target = `${config.mattermostUrl}${suffix}`
    const path = suffix.split('?')[0]!

    const raw = rawBody(req)
    const hasBody = raw !== undefined && raw.length > 0
    const requestBody = hasBody ? safeJson(raw.toString('utf8')) : null

    const notes: string[] = []
    for (const n of NOTABLE) {
        if (n.test.test(path)) {
            notes.push(n.note)
        }
    }
    if (!req.headers.authorization) {
        notes.push('No Authorization header. Mattermost will reject this as unauthenticated.')
    }

    const started = Date.now()
    let status = 502
    let responseBody: unknown = null
    let responseHeaders: Record<string, string> = {}

    try {
        const upstream = await fetch(target, {
            method: req.method,
            headers: forwardableHeaders(req.headers),
            body: hasBody ? raw : undefined,
            signal: AbortSignal.timeout(config.handlerTimeoutMs),
        })
        status = upstream.status
        responseHeaders = Object.fromEntries(upstream.headers.entries())
        responseBody = safeJson(await upstream.text())
    } catch (err) {
        const cause = (err as Error & {cause?: {code?: string}}).cause?.code
        notes.push(
            `Mattermost unreachable at ${config.mattermostUrl}: ${(err as Error).message}${cause ? ` (${cause})` : ''}`,
        )
        responseBody = {error: 'upstream unreachable'}
        responseHeaders = {'content-type': 'application/json'}
    }

    if (status === 401 || status === 403) {
        notes.push(
            `Mattermost rejected the credentials (${status}). Confirm the handler is sending ` +
                'Authorization: Bearer $MM_BOT_TOKEN and that the bot is a member of the target channel.',
        )
    }

    deps.journal.append({
        kind: 'handler_to_mm',
        route: path,
        correlationId,
        durationMs: Date.now() - started,
        request: capture(req.headers, requestBody, {method: req.method}),
        response: capture(responseHeaders, responseBody, {status}),
        notes: notes.length ? notes : undefined,
    })

    for (const [k, v] of Object.entries(responseHeaders)) {
        if (!HOP_BY_HOP.has(k.toLowerCase())) {
            reply.header(k, v)
        }
    }
    return reply.code(status).send(responseBody)
}
