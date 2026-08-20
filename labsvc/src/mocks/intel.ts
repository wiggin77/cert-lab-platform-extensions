/**
 * Mock threat intelligence API, the lookup target for Module 4's /threat command.
 *
 * Deliberately not a pure happy path. Two fixture cases exist so the lab can require
 * real error handling: an indicator that 404s, and one that returns 200 with no
 * campaigns. See DESIGN.md section 5.2.
 */

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'
import type {FastifyInstance} from 'fastify'

import type {Journal} from '../proxy/journal.js'
import type {IntelRecord} from '../types.js'

const HERE = dirname(fileURLToPath(import.meta.url))

type IntelFixture = {misses: string[]; records: IntelRecord[]}

const fixture = JSON.parse(readFileSync(resolve(HERE, '../../fixtures/indicators.json'), 'utf8')) as IntelFixture

const byIndicator = new Map(fixture.records.map((r) => [r.indicator.toLowerCase(), r]))
const misses = new Set(fixture.misses.map((m) => m.toLowerCase()))

export function registerIntelApi(app: FastifyInstance, deps: {journal: Journal}): void {
    app.get<{Params: {indicator: string}; Querystring: {delay_ms?: string}}>(
        '/mock/intel/v1/indicators/:indicator',
        async (req, reply) => {
            const raw = req.params.indicator
            const key = raw.toLowerCase()

            // Lets an instructor demonstrate the slash command timeout on demand.
            const delay = Number.parseInt(req.query.delay_ms ?? '', 10)
            if (Number.isFinite(delay) && delay > 0) {
                await new Promise((r) => setTimeout(r, Math.min(delay, 30_000)))
            }

            const record = misses.has(key) ? undefined : byIndicator.get(key)
            const status = record ? 200 : 404
            const body = record ?? {
                error: 'indicator_not_found',
                message: `No intelligence held for ${raw}. This is a normal result, not a failure.`,
                indicator: raw,
            }

            deps.journal.append({
                kind: 'intel_query',
                route: '/mock/intel/v1/indicators/:indicator',
                correlationId: (req.headers['x-lab-correlation-id'] as string) ?? 'direct',
                request: {headers: {}, body: {indicator: raw}, method: 'GET'},
                response: {headers: {}, body, status},
                notes: record
                    ? record.campaigns.length === 0
                        ? ['Known indicator with no campaign attribution. The handler must not assume a non-empty array.']
                        : undefined
                    : ['Indicator not found. The handler should say so cleanly rather than return a 500.'],
            })

            return reply.code(status).send(body)
        },
    )

    /** Handy for the lab guide and for writing checks. Not part of the taught API. */
    app.get('/mock/intel/v1/_catalog', async () => ({
        records: fixture.records.map((r) => ({indicator: r.indicator, type: r.indicator_type})),
        misses: fixture.misses,
    }))
}
