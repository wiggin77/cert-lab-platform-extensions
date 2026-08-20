/**
 * Append only, hash chained event journal.
 *
 * Three consumers:
 *   - the inspector UI, via the in memory ring and an SSE stream
 *   - the grader, as enrichment on top of Mattermost state (never as the source of truth,
 *     see DESIGN.md section 4.1)
 *   - post hoc debugging of a failed lab run, via the JSONL file
 *
 * The hash chain defeats casual tampering and makes edits detectable. It is not, and does
 * not claim to be, adversary proof: the learner has root on the sandbox. See DESIGN.md
 * section 6.4.
 */

import {createHash} from 'node:crypto'
import {createWriteStream, mkdirSync, type WriteStream} from 'node:fs'
import {dirname} from 'node:path'

import {config} from '../config.js'
import type {JournalEvent, JournalInput, JournalKind} from '../types.js'

const GENESIS = '0'.repeat(64)

export type JournalQuery = {
    since?: number
    kind?: JournalKind
    route?: string
    correlationId?: string
    limit?: number
}

type Subscriber = (event: JournalEvent) => void

export class Journal {
    #seq = 0
    #prevHash = GENESIS
    #ring: JournalEvent[] = []
    #subscribers = new Set<Subscriber>()
    #stream: WriteStream | null = null
    #degraded = false

    constructor(private readonly log: {warn: (msg: string) => void}) {
        this.#openStream()
    }

    #openStream(): void {
        try {
            mkdirSync(dirname(config.journal.path), {recursive: true})
            this.#stream = createWriteStream(config.journal.path, {flags: 'a'})
            this.#stream.on('error', (err) => {
                this.log.warn(`journal write failed, continuing in memory only: ${err.message}`)
                this.#degraded = true
                this.#stream = null
            })
        } catch (err) {
            this.log.warn(
                `journal path ${config.journal.path} is not writable, continuing in memory only: ${(err as Error).message}`,
            )
            this.#degraded = true
        }
    }

    get degraded(): boolean {
        return this.#degraded
    }

    /** Records an event and returns it with identity, timestamp, and chain hash filled in. */
    append(input: JournalInput): JournalEvent {
        const base = {
            seq: ++this.#seq,
            ts: new Date().toISOString(),
            module: input.module ?? config.module,
            kind: input.kind,
            route: input.route,
            request: input.request,
            response: input.response,
            durationMs: input.durationMs,
            correlationId: input.correlationId,
            notes: input.notes,
            prevHash: this.#prevHash,
        }

        const hash = createHash('sha256').update(JSON.stringify(base)).digest('hex')
        const event: JournalEvent = {...base, hash}
        this.#prevHash = hash

        this.#ring.push(event)
        if (this.#ring.length > config.journal.ringSize) {
            this.#ring.shift()
        }

        this.#stream?.write(`${JSON.stringify(event)}\n`)

        for (const fn of this.#subscribers) {
            try {
                fn(event)
            } catch {
                // A broken SSE client must never take down the proxy.
            }
        }

        return event
    }

    query(q: JournalQuery = {}): JournalEvent[] {
        let out = this.#ring
        if (q.since !== undefined) {
            out = out.filter((e) => e.seq > q.since!)
        }
        if (q.kind) {
            out = out.filter((e) => e.kind === q.kind)
        }
        if (q.route) {
            out = out.filter((e) => e.route === q.route)
        }
        if (q.correlationId) {
            out = out.filter((e) => e.correlationId === q.correlationId)
        }
        if (q.limit !== undefined) {
            out = out.slice(-q.limit)
        }
        return out
    }

    /** Highest sequence number issued so far. Used by the grader as a watermark. */
    get head(): number {
        return this.#seq
    }

    subscribe(fn: Subscriber): () => void {
        this.#subscribers.add(fn)
        return () => this.#subscribers.delete(fn)
    }

    /**
     * Verifies the in memory chain. Returns the seq of the first broken link, or null when
     * the chain is intact. The grader reports this rather than acting on it.
     */
    verify(): number | null {
        let prev = this.#ring[0]?.prevHash ?? GENESIS
        for (const event of this.#ring) {
            if (event.prevHash !== prev) {
                return event.seq
            }
            const {hash, ...base} = event
            if (createHash('sha256').update(JSON.stringify(base)).digest('hex') !== hash) {
                return event.seq
            }
            prev = hash
        }
        return null
    }

    /** Drops in memory history. The JSONL file is left intact as an audit trail. */
    clear(): void {
        this.#ring = []
    }
}
