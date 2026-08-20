/**
 * MODULE 3 SOLUTION  ·  Outgoing Webhooks
 *
 * Applied by the Instruqt solve script, and run against the Module 3 checks in CI.
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import {config} from '../config.js'
import {extractIndicator, parseAlertFromProps} from '../lib/alert.js'
import {attachment, code, field} from '../lib/attachments.js'
import {createPost, getPost, permalink} from '../lib/mattermost.js'
import type {OutgoingWebhookPayload, OutgoingWebhookResponse} from '../lib/types.js'
import {isValidToken} from '../lib/verify.js'

export async function handleOutgoingWebhook(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as OutgoingWebhookPayload

    // Step 1. Reject anything that does not carry the configured token, before doing any
    // work at all. isValidToken uses a constant time comparison, so the time taken does
    // not reveal how many leading bytes an attacker guessed correctly.
    if (!isValidToken(payload.token, config.outgoingWebhookToken)) {
        req.log.warn({channel: payload.channel_id}, 'rejected outgoing webhook with an invalid token')
        return reply.code(401).send({error: 'invalid token'})
    }

    // Step 2. The structured fields live in the post's attachment, not in payload.text,
    // so fetch the triggering post and read them back out.
    const post = await getPost(payload.post_id)
    const alert = parseAlertFromProps(post.props)

    const severity = alert.severity ?? 'CRITICAL'
    const indicator = alert.indicator ?? extractIndicator(payload.text) ?? 'unknown'
    const source = alert.source ?? 'unknown'

    // Step 3 and 4. Post the escalation to #incidents.
    //
    // A thread cannot span channels, so the link back to #alerts is a permalink rather
    // than a root_id.
    await createPost({
        channel_id: config.channels.incidents,
        message: '',
        attachments: [
            attachment({
                severity,
                title: `Auto-escalated: ${alert.title ?? payload.text.slice(0, 80)}`,
                text: `A ${severity} alert was detected in ~${payload.channel_name} and escalated automatically.`,
                fields: [
                    field('Severity', severity),
                    field('Source', source),
                    field('Indicator', code(indicator)),
                    field('Original alert', permalink(payload.post_id), false),
                ],
                footer: 'Automatic escalation, no analyst assessment attached',
                fallback: `[${severity}] auto-escalated ${indicator} from ${source}`,
            }),
        ],
    })

    req.log.info({indicator, severity}, 'escalated to #incidents')

    // Nothing needs to be said back in #alerts: the escalation went elsewhere and the
    // permalink connects the two. Returning an empty body keeps the channel quiet.
    const response: OutgoingWebhookResponse = {}
    return reply.send(response)
}
