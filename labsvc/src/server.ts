/**
 * labsvc entry point.
 *
 * Lab infrastructure for the Mattermost Platform Extension Expert certification track.
 * Runs beside the learner's handler and must survive the learner breaking it, so nothing
 * here imports learner code at module load time.
 */

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import Fastify from 'fastify'

import {config} from './config.js'
import {SnapshotStore, registerAdmin} from './admin/index.js'
import {registerGrader} from './grader/index.js'
import './grader/checks/index.js'
import {MockFeed} from './mocks/feed.js'
import {registerIntelApi} from './mocks/intel.js'
import {registerMockLlm} from './mocks/llm.js'
import {INBOUND_ROUTES, ResponseUrlRegistry, registerInboundProxy} from './proxy/inbound.js'
import {Journal} from './proxy/journal.js'
import {registerOutboundProxy} from './proxy/outbound.js'
import {redact} from './proxy/redact.js'
import type {FeedTransport, Severity} from './types.js'
import {jsonBody} from './util/body.js'

const HERE = dirname(fileURLToPath(import.meta.url))

const app = Fastify({
    logger: {level: config.logLevel},
    // The proxies forward bytes verbatim, so a slow handler must not be cut short here.
    requestTimeout: 0,
    bodyLimit: 8 * 1024 * 1024,
})

// Every body arrives as a raw Buffer. Routes that want structure call jsonBody().
//
// removeAllContentTypeParsers is load bearing. Fastify's built in application/json and
// x-www-form-urlencoded parsers take precedence over a '*' catch all, which would leave
// the proxies holding a parsed object where they need the original bytes.
app.removeAllContentTypeParsers()
app.addContentTypeParser('*', {parseAs: 'buffer'}, (_req, body, done) => done(null, body))

const journal = new Journal(app.log)
const snapshots = new SnapshotStore(journal)
const responseUrls = new ResponseUrlRegistry()
const feed = new MockFeed(journal, app.log)

// ---------------------------------------------------------------------------
// Health and self description
// ---------------------------------------------------------------------------

app.get('/healthz', async () => ({
    ok: true,
    module: config.module,
    journal: {degraded: journal.degraded, head: journal.head},
    feed: feed.status,
}))

/**
 * The exact strings a learner pastes into Mattermost.
 *
 * Printing these is worth more than a paragraph of lab copy, because the single most
 * common environment failure is pasting the browser facing Instruqt URL into an
 * integration when the caller is the Mattermost server process.
 */
app.get('/api/urls', async () => ({
    note: 'Paste these into Mattermost. They are called by the Mattermost server, not by your browser.',
    integrations: INBOUND_ROUTES.map((r) => ({
        label: r.label,
        module: r.module,
        url: `${config.publicBaseUrl}${r.path}`,
    })),
    handlerBaseUrl: config.handlerUrl,
    mattermostProxyBaseUrl: `${config.publicBaseUrl}/mm`,
    mockIntelBaseUrl: `${config.publicBaseUrl}/mock/intel/v1`,
    mockLlmBaseUrl: `${config.publicBaseUrl}/mock/llm/v1`,
}))

// ---------------------------------------------------------------------------
// Journal API
// ---------------------------------------------------------------------------

app.get<{Querystring: {since?: string; kind?: string; limit?: string}}>('/api/journal', async (req) => {
    const events = journal.query({
        since: req.query.since ? Number.parseInt(req.query.since, 10) : undefined,
        kind: req.query.kind as never,
        limit: req.query.limit ? Number.parseInt(req.query.limit, 10) : 200,
    })
    return {head: journal.head, events: events.map((e) => redact(e))}
})

app.get('/api/journal/stream', async (req, reply) => {
    reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
    })
    reply.raw.write(': connected\n\n')

    const unsubscribe = journal.subscribe((event) => {
        reply.raw.write(`data: ${JSON.stringify(redact(event))}\n\n`)
    })
    const keepalive = setInterval(() => reply.raw.write(': keepalive\n\n'), 20_000)

    req.raw.on('close', () => {
        clearInterval(keepalive)
        unsubscribe()
    })

    return reply
})

// ---------------------------------------------------------------------------
// Mock feed control
// ---------------------------------------------------------------------------

app.get('/mock/feed', async () => ({...feed.status, corpus: feed.alerts.map((a) => ({id: a.id, severity: a.severity, indicator: a.indicator}))}))

app.post('/mock/feed/fire', async (req, reply) => {
    const body = jsonBody<{severity?: Severity; indicator?: string; alertId?: string; transport?: FeedTransport}>(req, {})
    try {
        return await feed.fire(body)
    } catch (err) {
        return reply.code(502).send({error: (err as Error).message})
    }
})

app.post('/mock/feed/pause', async () => {
    feed.acquirePause('manual')
    return feed.status
})

app.post('/mock/feed/resume', async () => {
    // Manual resume clears every hold, including a grader lock left behind by a crash.
    feed.acquirePause('manual')()
    return feed.status
})

app.post('/mock/feed/start', async () => {
    feed.start()
    return feed.status
})

app.post('/mock/feed/stop', async () => {
    feed.stop()
    return feed.status
})

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

app.get('/inspector', async (_req, reply) => {
    // Read per request so a UI edit shows up without restarting the service.
    const html = readFileSync(resolve(HERE, 'inspector/index.html'), 'utf8')
    return reply.type('text/html; charset=utf-8').send(html)
})

app.get('/', async (_req, reply) => reply.redirect('/inspector'))

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

registerInboundProxy(app, {journal, responseUrls})
registerOutboundProxy(app, {journal})
registerIntelApi(app, {journal})
registerMockLlm(app, {journal})
registerGrader(app, {journal, feed, snapshots})
registerAdmin(app, {journal, snapshots, responseUrls})

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    await app.listen({host: config.host, port: config.port})

    app.log.info(`module ${config.module}, feed transport ${feed.defaultTransport}`)
    app.log.info(`inspector at ${config.publicBaseUrl}/inspector`)
    for (const route of INBOUND_ROUTES) {
        app.log.info(`  ${route.label.padEnd(28)} ${config.publicBaseUrl}${route.path}`)
    }

    if (journal.degraded) {
        app.log.warn('journal is memory only, grading still works but there is no audit trail')
    }
    if (!config.mattermostAdminToken) {
        app.log.warn('MM_ADMIN_TOKEN is unset, grading and reset are disabled')
    }
    if (config.feed.autostart) {
        feed.start()
    }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        feed.stop()
        void app.close().then(() => process.exit(0))
    })
}

main().catch((err) => {
    app.log.error(err)
    process.exit(1)
})
