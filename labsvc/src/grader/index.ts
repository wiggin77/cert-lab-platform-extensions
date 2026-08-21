/**
 * Grading framework.
 *
 * The load bearing property: every check supplies its own stimulus. A check must never
 * depend on the learner having manually fired the right thing at the right moment.
 *
 *   pause ambient feed -> snapshot -> stimulus -> poll for effect -> assert -> resume
 *
 * Checks assert against Mattermost state as the source of truth, and use the journal only
 * for enrichment and hints. A learner who bypasses the labsvc proxy still passes. See
 * DESIGN.md sections 4.1 and 6.1.
 */

import {randomUUID} from 'node:crypto'
import type {FastifyInstance} from 'fastify'

import {config} from '../config.js'
import {MattermostClient} from '../mm/client.js'
import type {MockFeed} from '../mocks/feed.js'
import type {Journal} from '../proxy/journal.js'
import type {SnapshotStore} from '../admin/index.js'
import {describeError} from '../util/errors.js'

export type CheckResult = {
    id: string
    title: string
    ok: boolean
    /** What was observed. Shown whether the check passed or failed. */
    detail: string
    /** Shown only on failure. Should name the next concrete action, not restate the rule. */
    hint?: string
    /** Journal seq the learner should look at in the inspector. */
    evidenceSeq?: number
}

export type CheckContext = {
    /** Admin scoped client. Checks read state with this, never with the learner's token. */
    mm: MattermostClient
    feed: MockFeed
    journal: Journal
    /** Tags this run's stimulus so it is distinguishable from ambient alerts. */
    runId: string
    /** Wall clock at run start. Anything older is pre-existing and must be ignored. */
    startedAt: number
    waitFor: <T>(fn: () => Promise<T | null>, opts?: WaitOptions) => Promise<T | null>
}

export type WaitOptions = {timeoutMs?: number; intervalMs?: number; label?: string}

export type CheckDefinition = {
    id: string
    title: string
    run: (ctx: CheckContext) => Promise<CheckResult>
}

export type ChallengeDefinition = {
    module: number
    challenge: number
    title: string
    checks: CheckDefinition[]
}

export type RunReport = {
    module: number
    challenge: number
    title: string
    pass: boolean
    runId: string
    durationMs: number
    checks: CheckResult[]
    /** Non null when the journal hash chain is broken, reported but never acted on. */
    journalChainBrokenAt: number | null
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, ChallengeDefinition>()

export function registerChallenge(def: ChallengeDefinition): void {
    registry.set(`${def.module}/${def.challenge}`, def)
}

export function listChallenges(): ChallengeDefinition[] {
    return [...registry.values()].sort((a, b) => a.module - b.module || a.challenge - b.challenge)
}

/** Placeholder for a challenge whose checks are not written yet. */
export function pending(module: number, challenge: number, title: string): ChallengeDefinition {
    return {
        module,
        challenge,
        title,
        checks: [
            {
                id: 'not-implemented',
                title: 'Checks for this challenge are not written yet',
                run: async () => ({
                    id: 'not-implemented',
                    title: 'Checks for this challenge are not written yet',
                    ok: false,
                    detail: `No assertions are registered for module ${module} challenge ${challenge}.`,
                    hint: 'This is a track authoring gap, not a learner error.',
                }),
            },
        ],
    }
}

// ---------------------------------------------------------------------------
// Helpers available to checks
// ---------------------------------------------------------------------------

function makeWaitFor(): CheckContext['waitFor'] {
    return async function waitFor<T>(fn: () => Promise<T | null>, opts: WaitOptions = {}): Promise<T | null> {
        const timeoutMs = opts.timeoutMs ?? 15_000
        const intervalMs = opts.intervalMs ?? 750
        const deadline = Date.now() + timeoutMs

        for (;;) {
            try {
                const value = await fn()
                if (value !== null && value !== undefined) {
                    return value
                }
            } catch {
                // Transient upstream errors are expected while the effect is settling.
            }
            if (Date.now() >= deadline) {
                return null
            }
            await new Promise((r) => setTimeout(r, intervalMs))
        }
    }
}

export function pass(id: string, title: string, detail: string, evidenceSeq?: number): CheckResult {
    return {id, title, ok: true, detail, evidenceSeq}
}

export function fail(id: string, title: string, detail: string, hint: string, evidenceSeq?: number): CheckResult {
    return {id, title, ok: false, detail, hint, evidenceSeq}
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export type GraderDeps = {
    journal: Journal
    feed: MockFeed
    snapshots: SnapshotStore
}

const lastRuns = new Map<string, RunReport>()

export async function runChallenge(module: number, challenge: number, deps: GraderDeps): Promise<RunReport | null> {
    const def = registry.get(`${module}/${challenge}`)
    if (!def) {
        return null
    }

    const runId = `grade-${randomUUID().slice(0, 8)}`
    const startedAt = Date.now()
    const release = deps.feed.acquirePause(runId)
    deps.snapshots.take(`before ${module}/${challenge}`)

    const ctx: CheckContext = {
        mm: new MattermostClient(config.mattermostAdminToken),
        feed: deps.feed,
        journal: deps.journal,
        runId,
        startedAt,
        waitFor: makeWaitFor(),
    }

    const results: CheckResult[] = []
    try {
        for (const check of def.checks) {
            try {
                results.push(await check.run(ctx))
            } catch (err) {
                results.push(
                    fail(
                        check.id,
                        check.title,
                        `The check could not run: ${describeError(err, `Mattermost (${config.mattermostUrl})`)}`,
                        'This is an environment fault rather than something wrong with your work. ' +
                            'Check the lab service with: sudo systemctl status mm-labsvc',
                    ),
                )
            }
        }
    } finally {
        release()
    }

    const report: RunReport = {
        module: def.module,
        challenge: def.challenge,
        title: def.title,
        pass: results.every((r) => r.ok),
        runId,
        durationMs: Date.now() - startedAt,
        checks: results,
        journalChainBrokenAt: deps.journal.verify(),
    }

    lastRuns.set(`${module}/${challenge}`, report)

    deps.journal.append({
        kind: 'grader_assert',
        route: `/grader/run/${module}/${challenge}`,
        correlationId: runId,
        request: {headers: {}, body: {module, challenge}, method: 'POST'},
        response: {headers: {}, body: report, status: report.pass ? 200 : 412},
    })

    return report
}

export function registerGrader(app: FastifyInstance, deps: GraderDeps): void {
    app.get('/grader/challenges', async () => ({
        challenges: listChallenges().map((c) => ({
            module: c.module,
            challenge: c.challenge,
            title: c.title,
            checks: c.checks.map((k) => ({id: k.id, title: k.title})),
        })),
    }))

    app.post<{Params: {module: string; challenge: string}}>(
        '/grader/run/:module/:challenge',
        async (req, reply) => {
            const module = Number.parseInt(req.params.module, 10)
            const challenge = Number.parseInt(req.params.challenge, 10)

            if (!config.mattermostAdminToken) {
                return reply.code(503).send({
                    pass: false,
                    checks: [
                        {
                            id: 'no-admin-token',
                            title: 'Lab service is not configured',
                            ok: false,
                            detail: 'MM_ADMIN_TOKEN is not set.',
                            hint: 'The track setup script must provide it. This is an environment fault, not a learner error.',
                        },
                    ],
                })
            }

            const report = await runChallenge(module, challenge, deps)
            if (!report) {
                return reply.code(404).send({error: `no checks registered for ${module}/${challenge}`})
            }
            return reply.code(report.pass ? 200 : 412).send(report)
        },
    )

    app.get<{Params: {module: string; challenge: string}}>('/grader/last/:module/:challenge', async (req, reply) => {
        const report = lastRuns.get(`${req.params.module}/${req.params.challenge}`)
        return report ? report : reply.code(404).send({error: 'no run recorded yet'})
    })
}
