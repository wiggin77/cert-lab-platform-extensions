/**
 * MODULE 4 SOLUTION  ·  Slash Commands
 *
 * Applied by the Instruqt solve script, and run against the Module 4 checks in CI.
 *
 * The shape of this file is the lesson. Mattermost gives a slash command a few seconds to
 * reply, and a threat intel lookup can outlast that, so the handler acknowledges first and
 * delivers the real answer afterwards. Note that `enrich` is deliberately NOT awaited.
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import {config} from '../config.js'
import {attachment, code, field} from '../lib/attachments.js'
import type {CommandResponse, IntelRecord, SlashCommandRequest} from '../lib/types.js'
import {isValidToken} from '../lib/verify.js'

export async function handleThreatCommand(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as SlashCommandRequest

    // Step 1. Reject anything without the configured token, before doing any work.
    if (!isValidToken(payload.token, config.commandToken)) {
        req.log.warn({user: payload.user_name}, 'rejected /threat with an invalid token')
        return reply.code(401).send({error: 'invalid token'})
    }

    // Step 2. The indicator is everything after the trigger.
    const indicator = payload.text.trim().split(/\s+/)[0] ?? ''
    if (!indicator) {
        return reply.send({
            response_type: 'ephemeral',
            text: 'Usage: `/threat <indicator>`, where the indicator is an IP address, a domain, or a SHA256 hash.',
        } satisfies CommandResponse)
    }

    // Step 3. Start the lookup without awaiting it, so the acknowledgment below is not
    // held up behind a slow third party. Awaiting here is the single most common way this
    // command fails: Mattermost gives up and shows the user a generic error.
    void enrich(indicator, payload).catch((err) => req.log.error({err, indicator}, 'enrichment failed'))

    // Step 4. Acknowledge immediately, to the invoking user only.
    return reply.send({
        response_type: 'ephemeral',
        text: `Looking up ${code(indicator)} against threat intelligence...`,
    } satisfies CommandResponse)
}

/**
 * Queries the intel API and delivers the result.
 *
 * Delivery goes through `payload.response_url`, the short lived URL Mattermost supplies
 * for exactly this purpose. It needs no bot token, which is what makes it the natural
 * choice for a delayed reply. Posting with the bot token would be equally acceptable.
 */
async function enrich(indicator: string, payload: SlashCommandRequest): Promise<void> {
    const res = await fetch(`${config.intelApiUrl}/indicators/${encodeURIComponent(indicator)}`, {
        signal: AbortSignal.timeout(20_000),
    })

    // A 404 is a normal result, not a failure. Plenty of indicators simply have no
    // intelligence held against them, and the analyst needs to be told that plainly
    // rather than shown an error.
    if (res.status === 404) {
        await respond(payload, {
            response_type: 'in_channel',
            text: `No threat intelligence is held for ${code(indicator)}. That is not a failure, it just means this indicator is unknown to the feed.`,
        })
        return
    }

    if (!res.ok) {
        await respond(payload, {
            response_type: 'ephemeral',
            text: `The threat intel lookup for ${code(indicator)} failed with HTTP ${res.status}. Try again shortly.`,
        })
        return
    }

    const record = (await res.json()) as IntelRecord

    // campaigns can legitimately be empty, so do not assume a non-empty array.
    const campaigns = record.campaigns.length > 0 ? record.campaigns.join(', ') : 'None attributed'

    await respond(payload, {
        response_type: 'in_channel',
        attachments: [
            attachment({
                title: `Threat intelligence: ${record.indicator}`,
                text: `Enrichment for ${code(record.indicator)} (${record.indicator_type}), requested by @${payload.user_name}.`,
                fields: [
                    field('Malware Family', record.malware_family),
                    field('Confidence', `${record.confidence}%`),
                    field('Last Seen', record.last_seen),
                    field('Campaigns', campaigns, false),
                ],
                footer: 'Mock threat intelligence, certification lab',
                fallback: `${record.indicator}: ${record.malware_family}, confidence ${record.confidence}%`,
            }),
        ],
    })
}

/** Posts a delayed response back to the URL Mattermost gave us. */
async function respond(payload: SlashCommandRequest, body: CommandResponse): Promise<void> {
    const res = await fetch(payload.response_url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
        throw new Error(`response_url returned ${res.status}: ${await res.text()}`)
    }
}
