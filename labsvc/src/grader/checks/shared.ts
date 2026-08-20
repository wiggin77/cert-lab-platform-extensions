/**
 * Helpers shared by check modules.
 *
 * Post identification is deliberately belt and braces. Props are the clean signal, but
 * Mattermost does not guarantee arbitrary props survive every creation path, so every
 * lookup falls back to matching on content within the run's time window.
 */

import {config} from '../../config.js'
import {attachmentOf, type Post} from '../../mm/client.js'
import type {Alert, JournalEvent, MessageAttachment} from '../../types.js'
import type {CheckContext} from '../index.js'

/** Everything in an attachment that a check might want to match against, as one string. */
export function attachmentText(post: Post): string {
    const parts: string[] = [post.message ?? '']
    const raw = post.props?.attachments
    if (Array.isArray(raw)) {
        for (const a of raw as MessageAttachment[]) {
            parts.push(a.fallback ?? '', a.title ?? '', a.text ?? '', a.pretext ?? '', a.footer ?? '')
            for (const f of a.fields ?? []) {
                parts.push(f.title ?? '', f.value ?? '')
            }
        }
    }
    return parts.join('\n')
}

/** Finds the post produced by a specific feed stimulus. */
export function findAlertPost(posts: Post[], alert: Alert, runId: string, since: number): Post | null {
    const candidates = posts.filter((p) => p.create_at >= since && p.delete_at === 0)

    const byProps = candidates.find(
        (p) => p.props?.lab_feed_run_id === runId && p.props?.lab_alert_id === alert.id,
    )
    if (byProps) {
        return byProps
    }

    // Props did not survive. Fall back to content.
    return candidates.find((p) => attachmentText(p).includes(alert.indicator)) ?? null
}

export async function waitForAlertPost(ctx: CheckContext, alert: Alert, since: number, timeoutMs = 15_000) {
    return ctx.waitFor(
        async () => findAlertPost(await ctx.mm.getChannelPosts(config.channels.alerts, {since}), alert, ctx.runId, since),
        {timeoutMs},
    )
}

export function firstAttachment(post: Post): MessageAttachment | undefined {
    return attachmentOf(post)
}

export function fieldNames(a: MessageAttachment | undefined): string[] {
    return (a?.fields ?? []).map((f) => (f.title ?? '').trim())
}

/**
 * Detects the most common environment mistake: pasting the browser facing Instruqt URL
 * into an integration, when the caller is the Mattermost server process.
 */
export function callbackUrlProblem(url: string): string | null {
    if (url.includes('env.play.instruqt.com')) {
        return (
            'That is the browser facing URL. Mattermost calls this from the server process, ' +
            `so it needs the internal address instead: ${config.publicBaseUrl}`
        )
    }
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
        return (
            'localhost resolves inside the Mattermost container, not on the workbench host. ' +
            `Use ${config.publicBaseUrl} instead.`
        )
    }
    return null
}

/**
 * Journal events recorded since this grading run began.
 *
 * Only for facts Mattermost state cannot show: handler status codes, handler latency, and
 * transient calls such as opening a dialog. Never use this where a post would do.
 */
export function journalSince(
    ctx: CheckContext,
    kind: JournalEvent['kind'],
    routeMatch?: string | RegExp,
): JournalEvent[] {
    return ctx.journal
        .query({kind})
        .filter((e) => Date.parse(e.ts) >= ctx.startedAt - 2000)
        .filter((e) => {
            if (!routeMatch) {
                return true
            }
            return typeof routeMatch === 'string' ? e.route === routeMatch : routeMatch.test(e.route)
        })
}

/** Flattens a journal event body back to searchable text. */
export function bodyText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value ?? '')
}

/** Signs that an error leaked into something a user can see. */
const LEAKED_ERROR = /\b(TypeError|ReferenceError|SyntaxError|ECONNREFUSED|Cannot read|is not a function|undefined is not)\b/

export function looksLikeLeakedError(text: string): boolean {
    return LEAKED_ERROR.test(text)
}

export const SEVERITY_COLOR_NAMES: Record<string, string> = {
    CRITICAL: 'red',
    HIGH: 'amber or orange',
    INFO: 'blue',
}

/** Loose colour family match, so learners are not forced onto one exact hex value. */
export function colorFamily(hex: string | undefined): 'red' | 'amber' | 'blue' | 'other' | 'none' {
    if (!hex) {
        return 'none'
    }
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
    if (!m) {
        const named = hex.trim().toLowerCase()
        if (named === 'red') return 'red'
        if (named === 'orange' || named === 'amber' || named === 'gold') return 'amber'
        if (named === 'blue') return 'blue'
        return 'other'
    }
    const n = Number.parseInt(m[1]!, 16)
    const r = (n >> 16) & 0xff
    const g = (n >> 8) & 0xff
    const b = n & 0xff

    if (r > 140 && r > g * 1.6 && r > b * 1.6) {
        return 'red'
    }
    if (r > 150 && g > 100 && b < Math.min(r, g) * 0.7) {
        return 'amber'
    }
    if (b > 120 && b > r * 1.3) {
        return 'blue'
    }
    return 'other'
}
