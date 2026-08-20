/**
 * MODULE 5  ·  Dialog Submission
 *
 * The analyst filled in the escalation dialog and pressed submit. Mattermost POSTs the
 * completed form here. Your job is to validate it and, if it is good, post a structured
 * escalation to #incidents.
 *
 * VALIDATION IS PART OF THE PROTOCOL
 *   Returning `{errors: {...}}` keyed by element name keeps the dialog open and shows the
 *   message under that specific field. Returning `{}` accepts and closes it. This is why
 *   you validate here rather than posting something malformed and apologising later.
 *
 * CANCELLATION
 *   payload.cancelled is true when the analyst dismissed the dialog. Return early.
 *
 * WHAT THE CHECK LOOKS FOR
 *   1. A submission with Severity blank comes back with a field level error
 *   2. A submission with Affected Systems blank comes back with a field level error
 *   3. A valid submission posts to #incidents carrying every form field, the analyst's
 *      username, a timestamp, and a link to the original alert
 *
 * THREADS DO NOT SPAN CHANNELS
 *   The escalation goes in #incidents, the alert is in #alerts, so a reply cannot join
 *   them. Use permalink() for the link back. If you also want a confirmation visible to
 *   the analyst in context, reply in the alert's own thread in #alerts.
 *
 * USEFUL HELPERS
 *   createPost(), createReply(), permalink() from ../lib/mattermost.js
 *   attachment(), field(), code()            from ../lib/attachments.js
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import type {SubmitDialogRequest, SubmitDialogResponse} from '../lib/types.js'

export async function handleDialogSubmit(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as SubmitDialogRequest

    req.log.info({user: payload.user_id, submission: payload.submission}, 'dialog submitted')

    if (payload.cancelled) {
        return reply.send({} satisfies SubmitDialogResponse)
    }

    // TODO Module 5, step 1: validate. Severity and Affected Systems must not be empty.
    // Return errors keyed by the element `name` you used when building the dialog, not by
    // its display_name:
    //
    //   return reply.send({errors: {severity: 'Choose a severity.'}})

    // TODO Module 5, step 2: recover the original alert's post id. You stashed it in the
    // dialog's `state` when you opened it, and it comes back on payload.state unchanged.

    // TODO Module 5, step 3: post the escalation to config.channels.incidents. Include
    // every submitted field, payload.user_id or the analyst's username, a timestamp, and
    // permalink(originalPostId).

    // An empty object accepts the submission and closes the dialog.
    const response: SubmitDialogResponse = {
        error: 'The escalation dialog handler is not implemented yet.',
    }
    return reply.send(response)
}
