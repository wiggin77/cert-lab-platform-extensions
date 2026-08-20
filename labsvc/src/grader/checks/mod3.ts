/**
 * Module 3, outgoing webhooks.
 *
 * Note the transport. The feed posts over REST as a bot here, not through an incoming
 * webhook, because posts created by an incoming webhook do not fire outgoing webhook
 * triggers. See DESIGN.md section 5.1.
 */

import {config} from '../../config.js'
import type {Post} from '../../mm/client.js'
import {fail, pass, registerChallenge, type CheckContext, type CheckResult} from '../index.js'
import {attachmentText, callbackUrlProblem, waitForAlertPost} from './shared.js'

const TRIGGER = 'CRITICAL'

function labsvcCallback(): string {
    return `${config.publicBaseUrl}/hooks/outgoing`
}

async function webhookConfigured(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod3-webhook-configured'
    const title = `An outgoing webhook on #alerts triggers on ${TRIGGER}`

    const hooks = await ctx.mm.getOutgoingWebhooks()
    const onAlerts = hooks.filter((h) => h.channel_id === config.channels.alerts)

    if (onAlerts.length === 0) {
        return fail(
            id,
            title,
            `Found ${hooks.length} outgoing webhook(s), none scoped to #alerts.`,
            `Integrations > Outgoing Webhooks > Add. Channel #alerts, trigger word ${TRIGGER}, callback URL ${labsvcCallback()}`,
        )
    }

    const withTrigger = onAlerts.find((h) =>
        ((h.trigger_words as string[]) ?? []).some((w) => w.toUpperCase() === TRIGGER),
    )
    if (!withTrigger) {
        const seen = onAlerts.flatMap((h) => (h.trigger_words as string[]) ?? [])
        return fail(
            id,
            title,
            `A webhook exists on #alerts but its trigger words are: ${seen.join(', ') || '(none)'}.`,
            `Set the trigger word to ${TRIGGER}. Note that Mattermost matches the trigger word at the start of a message, not anywhere within it.`,
        )
    }

    const urls = (withTrigger.callback_urls as string[]) ?? []
    for (const url of urls) {
        const problem = callbackUrlProblem(url)
        if (problem) {
            return fail(id, title, `Callback URL is ${url}.`, problem)
        }
    }

    return pass(id, title, `Trigger word ${TRIGGER} on #alerts, calling ${urls.join(', ')}.`)
}

async function escalationPosted(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod3-escalation-posted'
    const title = 'A CRITICAL alert auto-escalates to #incidents'

    const since = Date.now() - 1000
    const fired = await ctx.feed.fire({severity: 'CRITICAL', transport: 'bot_rest', runId: ctx.runId})
    const origin = await waitForAlertPost(ctx, fired.alert, since)

    if (!origin) {
        return fail(
            id,
            title,
            'The stimulus alert never appeared in #alerts.',
            'This is an environment fault rather than a learner error. Check that the feed bot can post to #alerts.',
        )
    }

    const escalation = await ctx.waitFor<Post>(
        async () => {
            const posts = await ctx.mm.getChannelPosts(config.channels.incidents, {since})
            return (
                posts.find(
                    (p) => p.create_at >= since && p.delete_at === 0 && attachmentText(p).includes(fired.alert.indicator),
                ) ?? null
            )
        },
        {timeoutMs: 20_000},
    )

    if (!escalation) {
        const sawCall = ctx.journal.query({kind: 'mm_to_handler', route: '/hooks/outgoing'}).at(-1)
        const hint = sawCall
            ? `Mattermost did reach your handler (it returned ${sawCall.response?.status}), but nothing landed in #incidents. Check the REST call in the Lab Inspector.`
            : 'Mattermost never called your handler. Confirm the trigger word, the channel, and the callback URL on the outgoing webhook.'
        return fail(id, title, 'No escalation appeared in #incidents within 20s.', hint, sawCall?.seq)
    }

    const text = attachmentText(escalation)
    const missing: string[] = []
    if (!text.includes(fired.alert.indicator)) {
        missing.push('indicator')
    }
    if (!text.toUpperCase().includes('CRITICAL')) {
        missing.push('severity')
    }
    if (!text.includes(fired.alert.source)) {
        missing.push('source')
    }
    if (!text.includes(origin.id)) {
        missing.push('permalink back to the original post')
    }

    if (missing.length) {
        return fail(
            id,
            title,
            `Escalation posted but is missing: ${missing.join(', ')}.`,
            'Include alert source, indicator, severity, and a permalink of the form ' +
                `${config.mattermostUrl}/<team>/pl/<post_id>. Threads cannot span channels, so a link is how you point back to #alerts.`,
        )
    }

    return pass(id, title, `Escalation for ${fired.alert.indicator} landed in #incidents with a link back to ${origin.id}.`)
}

async function tokenValidated(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod3-token-validation'
    const title = 'The handler rejects a request carrying the wrong token'

    const hooks = await ctx.mm.getOutgoingWebhooks()
    const hook = hooks.find((h) => h.channel_id === config.channels.alerts)
    if (!hook) {
        return fail(id, title, 'No outgoing webhook to read a token from.', 'Complete the first check before this one.')
    }

    const body = new URLSearchParams({
        token: 'obviously-not-the-right-token',
        team_id: 'lab',
        team_domain: 'lab',
        channel_id: config.channels.alerts,
        channel_name: 'alerts',
        timestamp: String(Date.now()),
        user_id: 'grader',
        user_name: 'grader',
        post_id: 'graderpostid0000000000000',
        text: 'CRITICAL forged escalation attempt 203.0.113.47',
        trigger_word: TRIGGER,
        file_ids: '',
    })

    const before = await ctx.mm.getChannelPosts(config.channels.incidents, {since: Date.now() - 1000})
    const beforeCount = before.length

    const res = await fetch(`http://127.0.0.1:${config.port}/hooks/outgoing`, {
        method: 'POST',
        headers: {'content-type': 'application/x-www-form-urlencoded'},
        body,
        signal: AbortSignal.timeout(20_000),
    })
    const responseText = await res.text()

    // Give a badly written handler time to post before we conclude it did not.
    await new Promise((r) => setTimeout(r, 3000))
    const after = await ctx.mm.getChannelPosts(config.channels.incidents, {since: Date.now() - 10_000})
    const leaked = after.some((p) => attachmentText(p).includes('forged escalation attempt'))

    if (leaked) {
        return fail(
            id,
            title,
            'A forged request with an invalid token still produced a post in #incidents.',
            'Compare the incoming token against the configured value before doing any work, and return early when it does not match. ' +
                'Use a constant time comparison, for example node:crypto timingSafeEqual.',
        )
    }

    if (res.status >= 200 && res.status < 300 && responseText.trim() !== '' && responseText !== '{}') {
        return pass(
            id,
            title,
            `Forged request produced no post. Handler answered ${res.status} without escalating (${beforeCount} pre-existing posts unchanged).`,
        )
    }

    return pass(id, title, `Forged request was rejected with ${res.status} and produced no post in #incidents.`)
}

registerChallenge({
    module: 3,
    challenge: 1,
    title: 'Outgoing webhook escalates CRITICAL alerts to #incidents',
    checks: [
        {id: 'mod3-webhook-configured', title: `An outgoing webhook on #alerts triggers on ${TRIGGER}`, run: webhookConfigured},
        {id: 'mod3-escalation-posted', title: 'A CRITICAL alert auto-escalates to #incidents', run: escalationPosted},
        {id: 'mod3-token-validation', title: 'The handler rejects a request carrying the wrong token', run: tokenValidated},
    ],
})
