/**
 * Snapshot and reset.
 *
 * Instruqt cleanup scripts call reset between challenges. Learners experiment, and without
 * a reset Module 5's check trips over Module 3's leftover escalations.
 *
 * The model is a watermark rather than a database snapshot: record a timestamp, then on
 * reset delete everything in the lab channels created after it. Cheap, and good enough
 * because lab channels only ever contain lab content.
 */

import {randomUUID} from 'node:crypto'
import type {FastifyInstance} from 'fastify'

import {config} from '../config.js'
import {MattermostClient} from '../mm/client.js'
import type {Journal} from '../proxy/journal.js'
import type {ResponseUrlRegistry} from '../proxy/inbound.js'

export type Snapshot = {
    id: string
    label: string
    takenAt: number
    journalSeq: number
}

export class SnapshotStore {
    #snapshots = new Map<string, Snapshot>()
    #latest: Snapshot | null = null

    constructor(private readonly journal: Journal) {}

    take(label: string): Snapshot {
        const snap: Snapshot = {
            id: randomUUID(),
            label,
            takenAt: Date.now(),
            journalSeq: this.journal.head,
        }
        this.#snapshots.set(snap.id, snap)
        this.#latest = snap
        return snap
    }

    get(id: string): Snapshot | undefined {
        return this.#snapshots.get(id)
    }

    get latest(): Snapshot | null {
        return this.#latest
    }

    list(): Snapshot[] {
        return [...this.#snapshots.values()].sort((a, b) => b.takenAt - a.takenAt)
    }
}

export type ResetReport = {
    snapshot: Snapshot
    deletedPosts: number
    channelsSwept: string[]
    errors: string[]
}

export async function resetToSnapshot(
    snap: Snapshot,
    deps: {journal: Journal; responseUrls: ResponseUrlRegistry},
): Promise<ResetReport> {
    const admin = new MattermostClient(config.mattermostAdminToken)
    const channels = [config.channels.alerts, config.channels.incidents].filter(Boolean)
    const errors: string[] = []
    let deleted = 0

    for (const channelId of channels) {
        try {
            const posts = await admin.getChannelPosts(channelId, {since: snap.takenAt, perPage: 200})
            for (const post of posts) {
                if (post.create_at <= snap.takenAt || post.delete_at !== 0) {
                    continue
                }
                try {
                    await admin.deletePost(post.id)
                    deleted++
                } catch (err) {
                    errors.push(`delete ${post.id}: ${(err as Error).message}`)
                }
            }
        } catch (err) {
            errors.push(`sweep ${channelId}: ${(err as Error).message}`)
        }
    }

    deps.responseUrls.clear()
    deps.journal.clear()

    const report: ResetReport = {snapshot: snap, deletedPosts: deleted, channelsSwept: channels, errors}

    deps.journal.append({
        kind: 'admin',
        route: '/admin/reset',
        correlationId: snap.id,
        request: {headers: {}, body: {snapshot: snap.id, label: snap.label}, method: 'POST'},
        response: {headers: {}, body: report, status: errors.length ? 207 : 200},
    })

    return report
}

export function registerAdmin(
    app: FastifyInstance,
    deps: {journal: Journal; snapshots: SnapshotStore; responseUrls: ResponseUrlRegistry},
): void {
    app.post<{Querystring: {label?: string}}>('/admin/snapshot', async (req) => {
        return deps.snapshots.take(req.query.label ?? 'manual')
    })

    app.get('/admin/snapshot', async () => ({snapshots: deps.snapshots.list()}))

    app.post<{Querystring: {to?: string}}>('/admin/reset', async (req, reply) => {
        const snap = req.query.to ? deps.snapshots.get(req.query.to) : deps.snapshots.latest
        if (!snap) {
            return reply.code(400).send({
                error: 'no snapshot',
                message: 'Take a snapshot first, or pass ?to=<snapshot_id>.',
            })
        }
        if (!config.mattermostAdminToken) {
            return reply.code(503).send({
                error: 'no admin token',
                message: 'MM_ADMIN_TOKEN is not set. The track setup script must provide it.',
            })
        }
        return resetToSnapshot(snap, deps)
    })
}
