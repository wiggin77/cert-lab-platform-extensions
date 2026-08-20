/**
 * Module 2, incoming webhooks.
 *
 * The learner creates the webhook in Mattermost and authors the attachment payload. This
 * is the one module where the feed uses the learner's own webhook and the learner's own
 * payload builder, so the checks assert on the resulting post rather than on any code.
 */

import {config} from '../../config.js'
import {fail, pass, registerChallenge, type CheckContext, type CheckResult} from '../index.js'
import {colorFamily, fieldNames, firstAttachment, SEVERITY_COLOR_NAMES, waitForAlertPost} from './shared.js'

const REQUIRED_FIELDS = ['Severity', 'Source', 'Indicator', 'Timestamp']

async function webhookExists(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod2-webhook-exists'
    const title = 'An incoming webhook is configured on #alerts'

    const hooks = await ctx.mm.getIncomingWebhooks()
    const match = hooks.find((h) => h.channel_id === config.channels.alerts)

    if (!match) {
        return fail(
            id,
            title,
            `Found ${hooks.length} incoming webhook(s), none targeting #alerts.`,
            'Integrations > Incoming Webhooks > Add. Set the channel to #alerts, then copy the URL into the lab environment file.',
        )
    }
    return pass(id, title, `Webhook "${match.display_name ?? match.id}" targets #alerts.`)
}

async function attachmentFormatted(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod2-attachment-format'
    const title = 'A fired alert renders as a formatted message attachment'

    const since = Date.now() - 1000
    const fired = await ctx.feed.fire({severity: 'CRITICAL', transport: 'incoming_webhook', runId: ctx.runId})
    const post = await waitForAlertPost(ctx, fired.alert, since)

    if (!post) {
        return fail(
            id,
            title,
            `Fired ${fired.alert.id} through the incoming webhook but no matching post appeared in #alerts within 15s.`,
            'Confirm the webhook URL in the lab environment file matches the one Mattermost shows, and that the webhook targets #alerts.',
        )
    }

    const attachment = firstAttachment(post)
    if (!attachment) {
        return fail(
            id,
            title,
            'The alert posted as plain text, with no attachment.',
            'Return an attachments array from buildAlertPayload rather than putting everything in text.',
        )
    }

    const problems: string[] = []

    if (!attachment.fallback || attachment.fallback.trim() === '') {
        problems.push('fallback is empty, so the notification preview will be blank')
    }

    const expected = SEVERITY_COLOR_NAMES[fired.alert.severity]
    const actual = colorFamily(attachment.color)
    if (fired.alert.severity === 'CRITICAL' && actual !== 'red') {
        problems.push(`colour bar reads as ${actual} for a CRITICAL alert, expected ${expected}`)
    }

    const names = fieldNames(attachment)
    const missing = REQUIRED_FIELDS.filter((f) => !names.some((n) => n.toLowerCase() === f.toLowerCase()))
    if (missing.length) {
        problems.push(`missing field(s): ${missing.join(', ')}`)
    }

    if (problems.length) {
        return fail(
            id,
            title,
            `Attachment rendered but: ${problems.join('; ')}.`,
            'Fields must be titled exactly Severity, Source, Indicator, and Timestamp. Colour is red for CRITICAL, amber for HIGH, blue for INFO.',
        )
    }

    return pass(
        id,
        title,
        `Alert ${fired.alert.id} rendered with all four fields, a ${actual} colour bar, and fallback text.`,
    )
}

async function severityColors(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod2-severity-colors'
    const title = 'Colour bar varies by severity'

    const observed: string[] = []
    for (const severity of ['HIGH', 'INFO'] as const) {
        const since = Date.now() - 1000
        const fired = await ctx.feed.fire({severity, transport: 'incoming_webhook', runId: ctx.runId})
        const post = await waitForAlertPost(ctx, fired.alert, since)

        if (!post) {
            return fail(
                id,
                title,
                `Fired a ${severity} alert but no matching post appeared in #alerts within 15s.`,
                'The webhook delivered the CRITICAL case, so this is likely an error thrown by buildAlertPayload for this severity. Check the lab service log.',
            )
        }

        const family = colorFamily(firstAttachment(post)?.color)
        observed.push(`${severity} -> ${family}`)

        const wanted = severity === 'HIGH' ? 'amber' : 'blue'
        if (family !== wanted) {
            return fail(
                id,
                title,
                `Observed ${observed.join(', ')}.`,
                `A ${severity} alert should use ${SEVERITY_COLOR_NAMES[severity]}. Map the colour from alert.severity rather than hardcoding one value.`,
            )
        }
    }

    return pass(id, title, `Observed ${observed.join(', ')}.`)
}

registerChallenge({
    module: 2,
    challenge: 1,
    title: 'Incoming webhook posts a formatted alert into #alerts',
    checks: [
        {id: 'mod2-webhook-exists', title: 'An incoming webhook is configured on #alerts', run: webhookExists},
        {
            id: 'mod2-attachment-format',
            title: 'A fired alert renders as a formatted message attachment',
            run: attachmentFormatted,
        },
        {id: 'mod2-severity-colors', title: 'Colour bar varies by severity', run: severityColors},
    ],
})
