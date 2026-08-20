/**
 * MODULE 3  ·  Outgoing Webhooks
 *
 * Mattermost calls this endpoint when a message in #alerts starts with the trigger word
 * you configured. Your job is to escalate CRITICAL alerts into #incidents automatically.
 *
 * WHAT THE CHECK LOOKS FOR
 *   1. A request carrying the wrong token is rejected and produces no post
 *   2. A CRITICAL alert produces a post in #incidents
 *   3. That post carries the alert's source, indicator, and severity
 *   4. That post links back to the original message in #alerts
 *
 * TWO THINGS WORTH KNOWING
 *   - The trigger word must be at the start of a message. Mattermost does not fire on a
 *     word appearing anywhere in the text.
 *   - Threads cannot span channels. You cannot reply in #incidents to a post in #alerts,
 *     which is why the check asks for a permalink instead.
 *
 * USEFUL HELPERS
 *   isValidToken()                     from ../lib/verify.js
 *   getPost(), createPost(), permalink() from ../lib/mattermost.js
 *   parseAlertFromProps()              from ../lib/alert.js
 *   attachment(), field(), code()      from ../lib/attachments.js
 *
 * TRY IT
 *   fire-alert.sh --severity CRITICAL
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import type {OutgoingWebhookPayload, OutgoingWebhookResponse} from '../lib/types.js'

export async function handleOutgoingWebhook(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as OutgoingWebhookPayload

    req.log.info({trigger: payload.trigger_word, post: payload.post_id}, 'outgoing webhook fired')

    // TODO Module 3, step 1: reject the request unless the token matches
    // config.outgoingWebhookToken. Do this before anything else, and use isValidToken
    // rather than === so the comparison does not leak the token one byte at a time.

    // TODO Module 3, step 2: fetch the triggering post with getPost(payload.post_id) and
    // pull the alert fields out of it with parseAlertFromProps(post.props).
    //
    // payload.text gives you the message text, but the structured fields live in the
    // attachment, which is why you need the post itself.

    // TODO Module 3, step 3: build an escalation attachment carrying the source,
    // indicator, and severity, plus permalink(payload.post_id) so the on-call team can
    // jump back to the original alert.

    // TODO Module 3, step 4: post it to config.channels.incidents with createPost().

    // The response body posts back into the triggering channel. Returning an empty object
    // stays silent, which is usually what you want when the real output went elsewhere.
    // Set response_type: 'comment' if you would rather acknowledge in the thread.
    const response: OutgoingWebhookResponse = {}
    return reply.send(response)
}
