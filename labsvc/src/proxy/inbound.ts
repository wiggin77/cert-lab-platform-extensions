/**
 * Inbound recording proxy: Mattermost -> labsvc -> the learner's handler.
 *
 * These are the URLs the learner pastes into Mattermost's integration configuration.
 * Everything is recorded so the inspector can answer the number one lab support question,
 * "is Mattermost even calling me".
 *
 * Two behaviours here are load bearing beyond plain recording:
 *
 *   1. response_url rewriting. Slash command payloads carry a response_url pointing back
 *      at Mattermost. We swap it for a labsvc URL so Module 4's delayed response becomes
 *      observable and gradeable. See DESIGN.md section 4.
 *
 *   2. Synthesised failure responses. When the handler is down or times out, Mattermost's
 *      own error surface is generic and unhelpful. We answer in the shape the calling
 *      surface expects, with a message that names the actual problem.
 */

import {randomUUID} from 'node:crypto'
import type {FastifyInstance, FastifyReply, FastifyRequest} from 'fastify'

import {config} from '../config.js'
import type {CapturedMessage} from '../types.js'
import {rawBody} from '../util/body.js'
import {describeError, errorName} from '../util/errors.js'
import {forwardableHeaders, relayableHeaders} from './headers.js'
import type {Journal} from './journal.js'

export type InboundKind = 'outgoing_webhook' | 'slash_command' | 'post_action' | 'dialog_submit'

export type InboundRoute = {
    /** Path on labsvc, the one the learner pastes into Mattermost. */
    path: string
    /** Path on the learner's handler. */
    target: string
    kind: InboundKind
    label: string
    module: number
}

export const INBOUND_ROUTES: InboundRoute[] = [
    {
        path: '/hooks/outgoing',
        target: '/webhooks/outgoing',
        kind: 'outgoing_webhook',
        label: 'Outgoing webhook',
        module: 3,
    },
    {
        path: '/commands/threat',
        target: '/commands/threat',
        kind: 'slash_command',
        label: 'Slash command /threat',
        module: 4,
    },
    {
        path: '/actions/escalate',
        target: '/actions/escalate',
        kind: 'post_action',
        label: 'Escalate button',
        module: 5,
    },
    {
        path: '/dialogs/escalate/submit',
        target: '/dialogs/escalate/submit',
        kind: 'dialog_submit',
        label: 'Escalation dialog submit',
        module: 5,
    },
]

/** Delayed response URLs are short lived on the Mattermost side too. */
const RESPONSE_URL_TTL_MS = 30 * 60 * 1000

type StoredResponseUrl = {url: string; createdAt: number; correlationId: string}

export class ResponseUrlRegistry {
    #entries = new Map<string, StoredResponseUrl>()

    put(url: string, correlationId: string): string {
        const id = randomUUID()
        this.#entries.set(id, {url, createdAt: Date.now(), correlationId})
        this.#sweep()
        return id
    }

    get(id: string): StoredResponseUrl | undefined {
        const entry = this.#entries.get(id)
        if (!entry) {
            return undefined
        }
        if (Date.now() - entry.createdAt > RESPONSE_URL_TTL_MS) {
            this.#entries.delete(id)
            return undefined
        }
        return entry
    }

    clear(): void {
        this.#entries.clear()
    }

    #sweep(): void {
        const cutoff = Date.now() - RESPONSE_URL_TTL_MS
        for (const [id, entry] of this.#entries) {
            if (entry.createdAt < cutoff) {
                this.#entries.delete(id)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Body handling
// ---------------------------------------------------------------------------

type ParsedBody = {
    /** Structured view for journaling and rewriting. */
    value: unknown
    /** Bytes to forward, possibly rewritten. */
    raw: Buffer
    form: URLSearchParams | null
}

function baseContentType(header: string | undefined): string {
    return (header ?? '').split(';')[0]!.trim().toLowerCase()
}

function parseBody(contentType: string, raw: Buffer): ParsedBody {
    if (contentType === 'application/x-www-form-urlencoded') {
        const form = new URLSearchParams(raw.toString('utf8'))
        return {value: Object.fromEntries(form), raw, form}
    }
    if (contentType === 'application/json') {
        try {
            return {value: JSON.parse(raw.toString('utf8')), raw, form: null}
        } catch {
            return {value: {__unparseable: raw.toString('utf8')}, raw, form: null}
        }
    }
    return {value: raw.toString('utf8'), raw, form: null}
}

function capture(headers: Record<string, unknown>, body: unknown, extra: Partial<CapturedMessage> = {}): CapturedMessage {
    const flat: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
        flat[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
    }

    let value = body
    let truncated = false
    const encoded = JSON.stringify(body) ?? ''
    if (encoded.length > config.journal.maxBodyBytes) {
        value = {__truncated: `${encoded.slice(0, config.journal.maxBodyBytes)}...`}
        truncated = true
    }

    return {headers: flat, body: value, truncated: truncated || undefined, ...extra}
}

// ---------------------------------------------------------------------------
// Failure responses, shaped per calling surface
// ---------------------------------------------------------------------------

function handlerDownMessage(reason: string): string {
    return [
        `**The lab handler did not respond.** (${reason})`,
        '',
        'Check it with:',
        '```',
        'sudo systemctl status mm-handler',
        'sudo journalctl -u mm-handler -n 50',
        '```',
        `Then look at the Lab Inspector at ${config.publicBaseUrl}/inspector to see what Mattermost sent.`,
    ].join('\n')
}

function synthesiseFailure(kind: InboundKind, reason: string): {status: number; body: unknown} {
    const text = handlerDownMessage(reason)
    switch (kind) {
        case 'slash_command':
            return {status: 200, body: {response_type: 'ephemeral', text}}
        case 'post_action':
            return {status: 200, body: {ephemeral_text: text}}
        case 'dialog_submit':
            return {status: 200, body: {error: `The lab handler did not respond (${reason}).`}}
        case 'outgoing_webhook':
            // Mattermost discards outgoing webhook errors, so there is nobody to tell.
            // The journal note is the only useful record.
            return {status: 200, body: {}}
    }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export type InboundDeps = {
    journal: Journal
    responseUrls: ResponseUrlRegistry
}

export function registerInboundProxy(app: FastifyInstance, deps: InboundDeps): void {
    for (const route of INBOUND_ROUTES) {
        app.post(route.path, async (req, reply) => proxyToHandler(route, req, reply, deps))
    }

    // Delayed responses, the rewritten response_url target. See Module 4.
    app.post<{Params: {id: string}}>('/hooks/commands/:id', async (req, reply) => {
        const entry = deps.responseUrls.get(req.params.id)
        const raw = rawBody(req)
        const contentType = baseContentType(req.headers['content-type'])
        const parsed = parseBody(contentType, raw)

        if (!entry) {
            deps.journal.append({
                kind: 'delayed_response',
                route: `/hooks/commands/${req.params.id}`,
                correlationId: 'unknown',
                request: capture(req.headers, parsed.value, {method: 'POST'}),
                response: capture({}, {error: 'unknown or expired response_url'}, {status: 410}),
                notes: [
                    'The response_url was not recognised. It has either expired or the handler stored a stale one.',
                ],
            })
            return reply.code(410).send({error: 'unknown or expired response_url'})
        }

        const started = Date.now()
        let status = 502
        let responseBody: unknown = null
        const notes: string[] = []

        try {
            const upstream = await fetch(entry.url, {
                method: 'POST',
                headers: {...forwardableHeaders(req.headers), 'content-type': contentType || 'application/json'},
                body: raw,
                signal: AbortSignal.timeout(config.handlerTimeoutMs),
            })
            status = upstream.status
            responseBody = await upstream.text()
        } catch (err) {
            notes.push(`Forwarding to Mattermost failed: ${(err as Error).message}`)
        }

        deps.journal.append({
            kind: 'delayed_response',
            route: `/hooks/commands/${req.params.id}`,
            correlationId: entry.correlationId,
            durationMs: Date.now() - started,
            request: capture(req.headers, parsed.value, {method: 'POST'}),
            response: capture({}, responseBody, {status}),
            notes: notes.length ? notes : undefined,
        })

        return reply.code(status === 502 ? 502 : 200).send(responseBody ?? '')
    })
}

async function proxyToHandler(
    route: InboundRoute,
    req: FastifyRequest,
    reply: FastifyReply,
    deps: InboundDeps,
): Promise<FastifyReply> {
    const correlationId = randomUUID()
    const contentType = baseContentType(req.headers['content-type'])
    const parsed = parseBody(contentType, rawBody(req))
    const notes: string[] = []

    let forwardBody = parsed.raw

    // Rewrite response_url so delayed responses come back through us.
    if (route.kind === 'slash_command' && parsed.form) {
        const original = parsed.form.get('response_url')
        if (original) {
            const id = deps.responseUrls.put(original, correlationId)
            parsed.form.set('response_url', `${config.publicBaseUrl}/hooks/commands/${id}`)
            forwardBody = Buffer.from(parsed.form.toString(), 'utf8')
            ;(parsed.value as Record<string, unknown>).response_url = parsed.form.get('response_url')
            notes.push('response_url rewritten to route delayed responses through labsvc')
        }
    }

    const requestCapture = capture(req.headers, parsed.value, {method: 'POST'})
    const started = Date.now()

    let status: number
    let responseBody: unknown
    let responseHeaders: Record<string, string> = {}

    try {
        const upstream = await fetch(`${config.handlerUrl}${route.target}`, {
            method: 'POST',
            headers: {
                ...forwardableHeaders(req.headers),
                'content-type': contentType || 'application/json',
                'x-lab-correlation-id': correlationId,
            },
            body: forwardBody,
            signal: AbortSignal.timeout(config.handlerTimeoutMs),
        })

        status = upstream.status
        responseHeaders = Object.fromEntries(upstream.headers.entries())
        const text = await upstream.text()
        const upstreamType = baseContentType(upstream.headers.get('content-type') ?? undefined)
        responseBody = upstreamType === 'application/json' && text ? safeJson(text) : text
    } catch (err) {
        const reason = describeFetchFailure(err, config.handlerTimeoutMs)
        notes.push(`Handler unreachable: ${reason}`)
        const synth = synthesiseFailure(route.kind, reason)
        status = synth.status
        responseBody = synth.body
        responseHeaders = {'content-type': 'application/json'}
    }

    const durationMs = Date.now() - started

    if (route.kind === 'slash_command' && durationMs > config.slashAckBudgetMs) {
        notes.push(
            `Handler took ${durationMs}ms to acknowledge, over the ${config.slashAckBudgetMs}ms budget. ` +
                'Acknowledge immediately and post the full result via response_url or the REST API.',
        )
    }
    if (status >= 400) {
        notes.push(`Handler returned ${status}. Mattermost surfaces this to the user as a generic failure.`)
    }

    deps.journal.append({
        kind: 'mm_to_handler',
        route: route.path,
        module: route.module,
        correlationId,
        durationMs,
        request: requestCapture,
        response: capture(responseHeaders, responseBody, {status}),
        notes: notes.length ? notes : undefined,
    })

    reply.header('x-lab-correlation-id', correlationId)
    for (const [k, v] of Object.entries(relayableHeaders(responseHeaders))) {
        reply.header(k, v)
    }
    return reply.code(status).send(responseBody)
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}

/** Describes why the handler could not be reached, in terms the learner can act on. */
export function describeFetchFailure(err: unknown, timeoutMs: number): string {
    if (errorName(err) === 'TimeoutError' || errorName(err) === 'AbortError') {
        return `no response in ${timeoutMs}ms`
    }
    return describeError(err, `your handler at ${config.handlerUrl}`, timeoutMs)
}
