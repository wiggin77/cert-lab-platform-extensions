/**
 * Mock threat intelligence feed.
 *
 * Two modes, and the mode switch is what makes labs reliable:
 *
 *   - ambient: one alert every FEED_INTERVAL_MS, seeded so the sequence is reproducible
 *   - scripted: the grader picks exactly which alert fires and when
 *
 * The ambient timer takes a pause lock while grading runs, otherwise a random CRITICAL
 * landing mid check produces flaky results.
 *
 * Transport matters. Posts created by an incoming webhook do NOT fire outgoing webhook
 * triggers, so Module 3 onward has to post over REST as a bot. Module 2 keeps the incoming
 * webhook because configuring one is the entire lesson. See DESIGN.md section 5.1.
 */

import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname, resolve} from 'node:path'

import {config} from '../config.js'
import {MattermostClient, postToIncomingWebhook} from '../mm/client.js'
import type {Journal} from '../proxy/journal.js'
import type {Alert, FeedTransport, IncomingWebhookRequest, Severity} from '../types.js'
import {describeError} from '../util/errors.js'

const HERE = dirname(fileURLToPath(import.meta.url))

type AlertFixture = {alerts: Alert[]}

const fixture = JSON.parse(readFileSync(resolve(HERE, '../../fixtures/alerts.json'), 'utf8')) as AlertFixture

/** Deterministic PRNG so a given FEED_SEED always yields the same alert sequence. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export const SEVERITY_COLORS: Record<Severity, string> = {
    CRITICAL: '#d24b4e',
    HIGH: '#f5ab00',
    INFO: '#1c58d9',
}

export type FireOptions = {
    severity?: Severity
    indicator?: string
    alertId?: string
    transport?: FeedTransport
    /** Set by the grader so its own stimulus is distinguishable from ambient noise. */
    runId?: string
}

export type FireResult = {
    alert: Alert
    transport: FeedTransport
    postId?: string
    ok: boolean
    detail: string
}

/**
 * Reference payload builder.
 *
 * In Module 2 the learner owns the payload shape. If FEED_PAYLOAD_MODULE points at a
 * learner authored module exporting buildAlertPayload(alert), we use theirs and fall back
 * to plain text on any error, which is exactly the failure the Module 2 scenario
 * describes ("alerts arrive as plain text or not at all"). From Module 3 onward the
 * reference builder below is used so later labs are not hostage to Module 2's output.
 */
export function referencePayload(alert: Alert): IncomingWebhookRequest {
    return {
        text: '',
        username: 'Threat Feed',
        icon_emoji: 'rotating_light',
        attachments: [
            {
                fallback: `[${alert.severity}] ${alert.title} (${alert.indicator})`,
                color: SEVERITY_COLORS[alert.severity],
                title: alert.title,
                text: alert.detail,
                fields: [
                    {title: 'Severity', value: alert.severity, short: true},
                    {title: 'Source', value: alert.source, short: true},
                    {title: 'Indicator', value: `\`${alert.indicator}\``, short: true},
                    {title: 'Timestamp', value: new Date().toISOString(), short: true},
                ],
                footer: 'Simulated feed, certification lab',
            },
        ],
    }
}

async function learnerPayload(alert: Alert, log: {warn: (m: string) => void}): Promise<IncomingWebhookRequest | null> {
    const modulePath = process.env.FEED_PAYLOAD_MODULE
    if (!modulePath) {
        return null
    }
    try {
        // Cache busted so the learner's edits take effect without restarting labsvc.
        //
        // Known limitation: a synchronous infinite loop in the learner's module would hang
        // this call. Move to a worker thread if that ever actually happens in a cohort.
        const mod = (await Promise.race([
            import(`${modulePath}?v=${Date.now()}`),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timed out after 3000ms')), 3000)),
        ])) as {buildAlertPayload?: (a: Alert) => IncomingWebhookRequest}

        if (typeof mod.buildAlertPayload !== 'function') {
            log.warn(`${modulePath} does not export buildAlertPayload`)
            return null
        }
        return mod.buildAlertPayload(alert)
    } catch (err) {
        log.warn(`learner payload module failed, falling back to plain text: ${(err as Error).message}`)
        return null
    }
}

function plainTextFallback(alert: Alert): IncomingWebhookRequest {
    return {text: `[${alert.severity}] ${alert.title} ${alert.indicator} from ${alert.source}`}
}

export class MockFeed {
    #rand = mulberry32(config.feed.seed)
    #timer: NodeJS.Timeout | null = null
    #paused = false
    #pauseHolders = new Set<string>()
    #runId = 'ambient'
    #bot: MattermostClient

    constructor(
        private readonly journal: Journal,
        private readonly log: {warn: (m: string) => void; info: (m: string) => void},
    ) {
        this.#bot = new MattermostClient(config.feedBotToken)
    }

    get alerts(): Alert[] {
        return fixture.alerts
    }

    get status() {
        return {
            running: this.#timer !== null,
            paused: this.#paused,
            pausedBy: [...this.#pauseHolders],
            intervalMs: config.feed.intervalMs,
            seed: config.feed.seed,
            defaultTransport: this.defaultTransport,
            corpusSize: fixture.alerts.length,
        }
    }

    /** Module 2 must exercise the learner's own incoming webhook. Later modules cannot. */
    get defaultTransport(): FeedTransport {
        return config.module <= 2 ? 'incoming_webhook' : 'bot_rest'
    }

    start(): void {
        if (this.#timer) {
            return
        }
        this.#timer = setInterval(() => {
            if (this.#paused) {
                return
            }
            void this.fire({}).catch((err) => this.log.warn(`ambient fire failed: ${err.message}`))
        }, config.feed.intervalMs)
        this.log.info(`ambient feed started, every ${config.feed.intervalMs}ms`)
    }

    stop(): void {
        if (this.#timer) {
            clearInterval(this.#timer)
            this.#timer = null
        }
    }

    /** Reentrant pause. The grader holds a lock for the duration of a check run. */
    acquirePause(holder: string): () => void {
        this.#pauseHolders.add(holder)
        this.#paused = true
        return () => {
            this.#pauseHolders.delete(holder)
            this.#paused = this.#pauseHolders.size > 0
        }
    }

    #select(opts: FireOptions): Alert {
        const pool = fixture.alerts.filter((a) => {
            if (opts.alertId && a.id !== opts.alertId) {
                return false
            }
            if (opts.severity && a.severity !== opts.severity) {
                return false
            }
            if (opts.indicator && a.indicator !== opts.indicator) {
                return false
            }
            return true
        })

        if (pool.length === 0) {
            throw new Error(
                `no alert in the corpus matches ${JSON.stringify(opts)}. ` +
                    `Known ids: ${fixture.alerts.map((a) => a.id).join(', ')}`,
            )
        }
        return pool[Math.floor(this.#rand() * pool.length)]!
    }

    async fire(opts: FireOptions): Promise<FireResult> {
        const alert = this.#select(opts)
        const transport = opts.transport ?? this.defaultTransport
        const runId = opts.runId ?? this.#runId

        // Prefer the learner's own builder whenever it works. Their integration is
        // continuous across modules, and Module 5 needs the Escalate button they add to
        // this very payload.
        //
        // The fallback differs by module on purpose. In Module 2 a broken builder must
        // produce plain text, because that is the scenario. From Module 3 on it falls back
        // to the reference builder, so a later lab is never blocked by earlier work.
        const payload =
            (await learnerPayload(alert, this.log)) ??
            (config.module <= 2 ? plainTextFallback(alert) : referencePayload(alert))

        const labProps = {lab_feed_run_id: runId, lab_alert_id: alert.id, lab_severity: alert.severity}

        let result: FireResult
        try {
            if (transport === 'incoming_webhook') {
                if (!config.feedIncomingWebhookUrl) {
                    throw new Error('MM_FEED_INCOMING_WEBHOOK_URL is not set. The learner has not created the webhook yet.')
                }
                const res = await postToIncomingWebhook(config.feedIncomingWebhookUrl, {
                    ...payload,
                    props: {...(payload.props ?? {}), ...labProps},
                })
                result = {
                    alert,
                    transport,
                    ok: res.ok,
                    detail: res.ok ? 'delivered via incoming webhook' : `webhook returned ${res.status}: ${res.body}`,
                }
            } else {
                const post = await this.#bot.createPost({
                    channel_id: config.channels.alerts,
                    message: payload.text || '',
                    props: {
                        ...(payload.props ?? {}),
                        ...labProps,
                        ...(payload.attachments ? {attachments: payload.attachments} : {}),
                    },
                })
                result = {alert, transport, postId: post.id, ok: true, detail: 'delivered via REST as bot'}
            }
        } catch (err) {
            // describeError here rather than at the throw site below, because re-throwing
            // a plain Error discards err.cause and with it the only useful diagnosis.
            result = {
                alert,
                transport,
                ok: false,
                detail: describeError(
                    err,
                    transport === 'incoming_webhook'
                        ? 'the incoming webhook URL'
                        : `Mattermost (${config.mattermostUrl})`,
                ),
            }
        }

        this.journal.append({
            kind: 'feed_fire',
            route: '/mock/feed/fire',
            correlationId: runId,
            request: {headers: {}, body: {alert, transport, runId, payload}},
            response: {headers: {}, body: result, status: result.ok ? 200 : 502},
            notes: result.ok
                ? transport === 'incoming_webhook'
                    ? ['Delivered via incoming webhook. This post will NOT fire outgoing webhook triggers.']
                    : undefined
                : [`Feed delivery failed: ${result.detail}`],
        })

        if (!result.ok) {
            throw new Error(result.detail)
        }
        return result
    }
}
