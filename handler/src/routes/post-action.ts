/**
 * MODULE 5  ·  Post Actions
 *
 * An analyst clicks the Escalate button on an alert. Mattermost POSTs here. Your job is to
 * open a dialog so they can add their assessment.
 *
 * TRIGGER_ID IS SHORT LIVED
 *   payload.trigger_id is your one chance to open a dialog and it expires within seconds.
 *   Do any slow work first, or skip it entirely, and call openDialog() as the last thing
 *   you do. If the dialog never appears, an expired trigger_id is the usual reason.
 *
 * WHERE THE BUTTON COMES FROM
 *   Buttons live in an attachment's `actions` array. Add one to the alert attachment you
 *   built in Module 2 using button() from ../lib/attachments.js, pointing at
 *   `${config.publicBaseUrl}/actions/escalate`. Put the alert's post id and indicator in
 *   the integration context so they come back to you here.
 *
 * WHAT THE CHECK LOOKS FOR
 *   1. openDialog() called with a valid trigger_id
 *   2. A dialog with exactly these elements:
 *        Severity          select, options CRITICAL / HIGH / MEDIUM
 *        Affected Systems  text
 *        Assignee          text
 *        Notes             textarea
 *
 * USEFUL HELPERS
 *   openDialog()  from ../lib/mattermost.js
 *   Dialog, DialogElement types from ../lib/types.js
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import type {PostActionIntegrationRequest, PostActionIntegrationResponse} from '../lib/types.js'

export async function handlePostAction(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as PostActionIntegrationRequest

    req.log.info({user: payload.user_id, post: payload.post_id, context: payload.context}, 'post action clicked')

    // TODO Module 5, step 1: build the dialog. callback_id identifies it on submission,
    // and state is an opaque string that round trips unchanged, which makes it the right
    // place to stash the originating post id.

    // TODO Module 5, step 2: call openDialog() with payload.trigger_id and a url of
    // `${config.publicBaseUrl}/dialogs/escalate/submit`.
    //
    // Note there is no token on this surface. Mattermost authenticates the dialog through
    // trigger_id, which it issued and which expires.

    // ephemeral_text shows a message only to the clicking user. Useful for reporting a
    // failure without cluttering the channel.
    const response: PostActionIntegrationResponse = {
        ephemeral_text: 'The Escalate action is not implemented yet.',
    }
    return reply.send(response)
}
