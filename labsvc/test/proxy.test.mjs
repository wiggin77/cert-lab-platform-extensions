/**
 * Proxy integration tests.
 *
 * Runs the real labsvc server as a subprocess between two stub servers standing in for
 * Mattermost and the learner's handler, so the assertions cover actual HTTP behaviour
 * rather than a mocked approximation.
 *
 * These exist because the proxies had a bug that only appeared once traffic actually flowed
 * through them: `fetch` decodes a gzipped upstream body transparently, and the proxy relayed
 * the upstream's `content-encoding` alongside the now-plain bytes, so the caller tried to
 * inflate plaintext and got Z_DATA_ERROR. It survived several full track runs because the
 * handler was bypassing the proxy at the time. A 5 second test would have caught it.
 *
 *   node --test labsvc/test/
 */

import {strict as assert} from 'node:assert'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {after, before, describe, it} from 'node:test'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import {gzipSync} from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const LABSVC_PORT = 14555
const MM_PORT = 14556
const HANDLER_PORT = 14557

const L = `http://127.0.0.1:${LABSVC_PORT}`

/** Requests each stub received, so tests can assert on what was forwarded. */
const seen = {mm: [], handler: []}

let mmServer
let handlerServer
let labsvc

/** Stands in for Mattermost. Always gzips, which is the case that broke. */
function startMattermost() {
    return new Promise((done) => {
        mmServer = createServer((req, res) => {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
                seen.mm.push({method: req.method, url: req.url, headers: req.headers, body})
                const payload = gzipSync(JSON.stringify({id: 'postid123', ok: true}))
                res.writeHead(200, {
                    'content-type': 'application/json',
                    'content-encoding': 'gzip',
                    'content-length': String(payload.length),
                })
                res.end(payload)
            })
        }).listen(MM_PORT, done)
    })
}

/** Stands in for the learner's handler. */
function startHandler() {
    return new Promise((done) => {
        handlerServer = createServer((req, res) => {
            let body = ''
            req.on('data', (c) => (body += c))
            req.on('end', () => {
                seen.handler.push({method: req.method, url: req.url, headers: req.headers, body})
                res.writeHead(200, {'content-type': 'application/json'})
                res.end(JSON.stringify({response_type: 'ephemeral', text: 'ack'}))
            })
        }).listen(HANDLER_PORT, done)
    })
}

async function startLabsvc(env = {}) {
    labsvc = spawn(resolve(HERE, '../node_modules/.bin/tsx'), ['src/server.ts'], {
        cwd: resolve(HERE, '..'),
        env: {
            ...process.env,
            LABSVC_PORT: String(LABSVC_PORT),
            LABSVC_PUBLIC_BASE_URL: L,
            MM_URL: `http://127.0.0.1:${MM_PORT}`,
            HANDLER_URL: `http://127.0.0.1:${HANDLER_PORT}`,
            JOURNAL_PATH: '/tmp/labsvc-test-journal.jsonl',
            LOG_LEVEL: 'silent',
            ...env,
        },
        stdio: 'ignore',
    })

    const deadline = Date.now() + 30_000
    for (;;) {
        try {
            const res = await fetch(`${L}/healthz`, {signal: AbortSignal.timeout(1000)})
            if (res.ok) return
        } catch {
            // not up yet
        }
        if (Date.now() > deadline) throw new Error('labsvc did not start')
        await new Promise((r) => setTimeout(r, 300))
    }
}

before(async () => {
    await startMattermost()
    await startHandler()
    await startLabsvc()
})

after(() => {
    labsvc?.kill()
    mmServer?.close()
    handlerServer?.close()
})

describe('outbound proxy, handler to Mattermost', () => {
    it('relays a gzipped response the caller can actually read', async () => {
        const res = await fetch(`${L}/mm/api/v4/posts`)
        // The bug surfaced here as a thrown "terminated" with cause Z_DATA_ERROR.
        const body = await res.text()
        assert.equal(res.status, 200)
        assert.deepEqual(JSON.parse(body), {id: 'postid123', ok: true})
    })

    it('does not relay content-encoding for a body it already decoded', async () => {
        const res = await fetch(`${L}/mm/api/v4/posts`)
        await res.text()
        assert.equal(res.headers.get('content-encoding'), null)
        assert.match(res.headers.get('content-type'), /application\/json/)
    })

    it('forwards a POST body byte for byte', async () => {
        const payload = {channel_id: 'chan1', message: 'hello', props: {nested: [1, 2]}}
        await fetch(`${L}/mm/api/v4/posts`, {
            method: 'POST',
            headers: {'content-type': 'application/json'},
            body: JSON.stringify(payload),
        })
        const last = seen.mm.at(-1)
        assert.equal(last.method, 'POST')
        assert.deepEqual(JSON.parse(last.body), payload)
    })

    it('forwards the caller Authorization header without substituting its own', async () => {
        await fetch(`${L}/mm/api/v4/users/me`, {headers: {authorization: 'Bearer learner-token'}})
        assert.equal(seen.mm.at(-1).headers.authorization, 'Bearer learner-token')
    })

    it('strips the path prefix so the upstream sees the real route', async () => {
        await fetch(`${L}/mm/api/v4/channels/abc/posts?per_page=5`)
        assert.equal(seen.mm.at(-1).url, '/api/v4/channels/abc/posts?per_page=5')
    })
})

describe('inbound proxy, Mattermost to handler', () => {
    it('rewrites response_url to point back at labsvc', async () => {
        const form = new URLSearchParams({
            token: 'tok',
            command: '/threat',
            text: '203.0.113.47',
            response_url: 'http://mattermost:8065/hooks/commands/REALID',
        })
        await fetch(`${L}/commands/threat`, {
            method: 'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: form,
        })

        const received = new URLSearchParams(seen.handler.at(-1).body)
        const rewritten = received.get('response_url')
        assert.ok(rewritten.startsWith(`${L}/hooks/commands/`), `not rewritten: ${rewritten}`)
        assert.ok(!rewritten.includes('REALID'), 'original Mattermost URL leaked to the handler')
        // Everything else must survive untouched.
        assert.equal(received.get('text'), '203.0.113.47')
        assert.equal(received.get('token'), 'tok')
    })

    it('passes a form encoded body through as form encoded', async () => {
        await fetch(`${L}/hooks/outgoing`, {
            method: 'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({token: 't', trigger_word: 'CRITICAL', text: 'CRITICAL beacon'}),
        })
        const last = seen.handler.at(-1)
        assert.match(last.headers['content-type'], /x-www-form-urlencoded/)
        assert.equal(new URLSearchParams(last.body).get('trigger_word'), 'CRITICAL')
    })

    it('records both directions in the journal', async () => {
        await fetch(`${L}/mm/api/v4/posts`)
        await fetch(`${L}/hooks/outgoing`, {
            method: 'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({token: 't'}),
        })

        const {events} = await (await fetch(`${L}/api/journal?limit=200`)).json()
        const kinds = new Set(events.map((e) => e.kind))
        assert.ok(kinds.has('handler_to_mm'), 'outbound call not journaled')
        assert.ok(kinds.has('mm_to_handler'), 'inbound call not journaled')
    })

    it('redacts tokens on the way out to the browser but keeps the body shape', async () => {
        await fetch(`${L}/hooks/outgoing`, {
            method: 'POST',
            headers: {'content-type': 'application/x-www-form-urlencoded'},
            body: new URLSearchParams({token: 'supersecrettoken1234567890'}),
        })
        const {events} = await (await fetch(`${L}/api/journal?limit=50`)).json()
        const event = events.filter((e) => e.route === '/hooks/outgoing').at(-1)
        assert.ok(event, 'no journal event for the call')
        assert.notEqual(event.request.body.token, 'supersecrettoken1234567890', 'token was not redacted')
    })
})

describe('inbound proxy with the handler down', () => {
    it('answers each surface in the shape that surface expects', async () => {
        handlerServer.close()
        await new Promise((r) => setTimeout(r, 200))

        const cases = [
            ['/commands/threat', 'text'],
            ['/actions/escalate', 'ephemeral_text'],
            ['/dialogs/escalate/submit', 'error'],
        ]

        for (const [route, field] of cases) {
            const res = await fetch(`${L}${route}`, {
                method: 'POST',
                headers: {'content-type': 'application/json'},
                body: '{}',
            })
            const body = await res.json()
            assert.equal(res.status, 200, `${route} should answer 200, not surface a raw failure`)
            assert.ok(body[field], `${route} response is missing ${field}: ${JSON.stringify(body)}`)
            // The learner must get a cause, not Node's bare "fetch failed".
            assert.match(String(body[field]), /listening|respond/i, `${route} message is not actionable`)
        }
    })
})
