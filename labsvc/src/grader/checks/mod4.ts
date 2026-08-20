/**
 * Module 4, slash commands.
 *
 * Stimulus is POST /api/v4/commands/execute as the grader's user, which returns the
 * immediate CommandResponse. Source: channels/api4/command.go:19
 *
 * Delivery of the enrichment is graded either way the learner chooses:
 *   - a persisted post in #alerts (what the lab copy asks for), or
 *   - a delayed response through response_url, which the inbound proxy records
 *
 * Both are legitimate. Requiring only the first would fail a learner who used the very
 * mechanism the module teaches.
 */

import {config} from '../../config.js'
import type {Post} from '../../mm/client.js'
import {describeError} from '../../util/errors.js'
import {fail, pass, registerChallenge, type CheckContext, type CheckResult} from '../index.js'
import {attachmentText, bodyText, callbackUrlProblem, journalSince, looksLikeLeakedError} from './shared.js'

/** Present in fixtures/indicators.json with a full record. */
const KNOWN = {
    indicator: '203.0.113.47',
    family: 'Emotet',
    confidence: '92',
    campaign: 'TA542 Autumn Wave',
}

/** Listed in fixtures/indicators.json "misses", so the intel API returns 404. */
const UNKNOWN_INDICATOR = '198.51.100.23'

async function commandRegistered(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod4-command-registered'
    const title = 'A /threat slash command is registered'

    if (!config.team.id) {
        return fail(id, title, 'MM_TEAM_ID is not set.', 'Environment fault rather than a learner error.')
    }

    const commands = await ctx.mm.getCommands(config.team.id)
    const threat = commands.find((c) => String(c.trigger ?? '').toLowerCase() === 'threat')

    if (!threat) {
        const triggers = commands.map((c) => `/${c.trigger}`).join(', ') || '(none)'
        return fail(
            id,
            title,
            `No /threat command found. Registered custom commands: ${triggers}.`,
            `Integrations > Slash Commands > Add. Trigger word "threat", request URL ${config.publicBaseUrl}/commands/threat, method POST.`,
        )
    }

    const url = String(threat.url ?? '')
    const problem = callbackUrlProblem(url)
    if (problem) {
        return fail(id, title, `Request URL is ${url}.`, problem)
    }

    if (String(threat.method ?? '').toUpperCase() !== 'P') {
        // Mattermost stores the method as "P" for POST and "G" for GET.
        return fail(
            id,
            title,
            `The command is configured with request method "${threat.method}".`,
            'Set the request method to POST. A GET sends the payload as query parameters, which the handler does not read.',
        )
    }

    return pass(id, title, `/threat is registered, calling ${url}.`)
}

/** Runs the command and returns both the immediate response and the handler's own timing. */
async function invoke(ctx: CheckContext, indicator: string) {
    const since = Date.now() - 1000
    let response: Record<string, unknown> = {}
    let transportError: string | null = null

    try {
        response = await ctx.mm.executeCommand(config.channels.alerts, `/threat ${indicator}`)
    } catch (err) {
        transportError = describeError(err, `Mattermost (${config.mattermostUrl})`)
    }

    const handlerCall = journalSince(ctx, 'mm_to_handler', '/commands/threat').at(-1)
    return {since, response, transportError, handlerCall}
}

/** Finds the enrichment wherever the learner chose to deliver it. */
async function findEnrichment(
    ctx: CheckContext,
    since: number,
    indicator: string,
): Promise<{via: string; text: string} | null> {
    const found = await ctx.waitFor<{via: string; text: string}>(
        async () => {
            const posts = await ctx.mm.getChannelPosts(config.channels.alerts, {since})
            const post = posts.find(
                (p: Post) => p.create_at >= since && p.delete_at === 0 && attachmentText(p).includes(indicator),
            )
            if (post) {
                return {via: 'a post in #alerts', text: attachmentText(post)}
            }

            const delayed = journalSince(ctx, 'delayed_response').find((e) =>
                bodyText(e.request.body).includes(indicator),
            )
            if (delayed) {
                return {via: 'a delayed response through response_url', text: bodyText(delayed.request.body)}
            }
            return null
        },
        {timeoutMs: 20_000},
    )
    return found
}

async function enrichmentReturned(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod4-enrichment'
    const title = 'A known indicator returns enrichment data'

    const {since, response, transportError, handlerCall} = await invoke(ctx, KNOWN.indicator)

    if (transportError) {
        return fail(
            id,
            title,
            `Running /threat failed: ${transportError}`,
            'Mattermost could not execute the command. Confirm the previous check passes first.',
            handlerCall?.seq,
        )
    }
    if (!handlerCall) {
        return fail(
            id,
            title,
            'Mattermost never called your handler.',
            `The command ran but no request reached ${config.publicBaseUrl}/commands/threat. Check the request URL on the slash command.`,
        )
    }
    if ((handlerCall.response?.status ?? 0) >= 400) {
        return fail(
            id,
            title,
            `Your handler returned ${handlerCall.response?.status}.`,
            'Mattermost shows the user a generic failure for any non-2xx. Open the Lab Inspector to see the body.',
            handlerCall.seq,
        )
    }

    const ack = JSON.stringify(response)
    if (looksLikeLeakedError(ack)) {
        return fail(id, title, `The acknowledgment leaked an error: ${ack.slice(0, 160)}`, 'Catch the failure and return a readable message.', handlerCall.seq)
    }

    const enrichment = await findEnrichment(ctx, since, KNOWN.indicator)
    if (!enrichment) {
        const queried = journalSince(ctx, 'intel_query').length > 0
        return fail(
            id,
            title,
            `No enrichment for ${KNOWN.indicator} appeared within 20s.`,
            queried
                ? 'You queried the intel API but the result never reached the channel. Post it with createPost, or POST your CommandResponse to payload.response_url.'
                : 'The intel API was never queried. Confirm you fetch ${INTEL_API_URL}/indicators/<indicator> after acknowledging.',
            handlerCall.seq,
        )
    }

    const missing = [
        [KNOWN.family, 'malware family'],
        [KNOWN.confidence, 'confidence score'],
        [KNOWN.campaign, 'associated campaigns'],
    ]
        .filter(([needle]) => !enrichment.text.includes(needle!))
        .map(([, label]) => label)

    if (!/last[_ ]?seen|2026-/i.test(enrichment.text)) {
        missing.push('last seen')
    }

    if (missing.length) {
        return fail(
            id,
            title,
            `Enrichment delivered via ${enrichment.via}, but is missing: ${missing.join(', ')}.`,
            'Include malware family, confidence score, last seen, and associated campaigns as attachment fields.',
            handlerCall.seq,
        )
    }

    return pass(id, title, `Enrichment for ${KNOWN.indicator} delivered via ${enrichment.via} with all four fields.`)
}

async function acknowledgedInTime(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod4-ack-budget'
    const title = 'The command acknowledges within the timeout budget'

    const {response, handlerCall} = await invoke(ctx, KNOWN.indicator)

    if (!handlerCall) {
        return fail(id, title, 'Your handler was not called, so there is nothing to time.', 'Fix the previous check first.')
    }

    const took = handlerCall.durationMs ?? 0
    if (took > config.slashAckBudgetMs) {
        return fail(
            id,
            title,
            `Your handler took ${took}ms to respond. The budget is ${config.slashAckBudgetMs}ms.`,
            'Do not await the lookup before replying. Return an ephemeral acknowledgment immediately, then deliver the result via response_url or the REST API.',
            handlerCall.seq,
        )
    }

    if (!String(response.text ?? '').trim() && !Array.isArray(response.attachments)) {
        return fail(
            id,
            title,
            `Your handler replied in ${took}ms but the response body was empty.`,
            'Return an ephemeral acknowledgment naming the indicator, so the analyst knows the lookup is running.',
            handlerCall.seq,
        )
    }

    const type = String(response.response_type ?? '')
    if (type && type !== 'ephemeral' && type !== 'in_channel') {
        return fail(
            id,
            title,
            `response_type was "${type}".`,
            'Only "ephemeral" and "in_channel" are accepted. Anything else is rejected outright.',
            handlerCall.seq,
        )
    }

    return pass(id, title, `Acknowledged in ${took}ms, inside the ${config.slashAckBudgetMs}ms budget.`)
}

async function unknownIndicatorHandled(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod4-unknown-indicator'
    const title = 'An indicator with no intel is handled cleanly'

    const {since, response, handlerCall} = await invoke(ctx, UNKNOWN_INDICATOR)

    if (!handlerCall) {
        return fail(id, title, 'Your handler was not called.', 'Fix the earlier checks first.')
    }
    if ((handlerCall.response?.status ?? 0) >= 500) {
        return fail(
            id,
            title,
            `Your handler returned ${handlerCall.response?.status} for an indicator the API does not hold.`,
            `A 404 from the intel API is a normal result, not a failure. Check the response status before parsing, and tell the analyst nothing is held on ${UNKNOWN_INDICATOR}.`,
            handlerCall.seq,
        )
    }

    const delivered = await findEnrichment(ctx, since, UNKNOWN_INDICATOR)
    const surface = `${JSON.stringify(response)} ${delivered?.text ?? ''}`

    if (looksLikeLeakedError(surface)) {
        return fail(
            id,
            title,
            `A raw error reached the user: ${surface.slice(0, 180)}`,
            'Catch the miss and return a readable sentence instead of letting the exception surface.',
            handlerCall.seq,
        )
    }

    if (!surface.includes(UNKNOWN_INDICATOR)) {
        return fail(
            id,
            title,
            'Nothing mentioning the indicator was shown to the analyst.',
            `Say plainly that no intelligence is held on ${UNKNOWN_INDICATOR}. Silence is indistinguishable from a broken command.`,
            handlerCall.seq,
        )
    }

    return pass(id, title, `Handler returned ${handlerCall.response?.status} and reported the miss to the analyst.`)
}

registerChallenge({
    module: 4,
    challenge: 1,
    title: 'Slash command /threat returns IOC enrichment',
    checks: [
        {id: 'mod4-command-registered', title: 'A /threat slash command is registered', run: commandRegistered},
        {id: 'mod4-ack-budget', title: 'The command acknowledges within the timeout budget', run: acknowledgedInTime},
        {id: 'mod4-enrichment', title: 'A known indicator returns enrichment data', run: enrichmentReturned},
        {id: 'mod4-unknown-indicator', title: 'An indicator with no intel is handled cleanly', run: unknownIndicatorHandled},
    ],
})
