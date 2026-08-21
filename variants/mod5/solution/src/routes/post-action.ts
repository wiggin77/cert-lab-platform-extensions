/**
 * MODULE 5 SOLUTION  ·  Post Actions
 *
 * Applied by the Instruqt solve script, and run against the Module 5 checks in CI.
 *
 * Note the ordering. `trigger_id` expires within seconds, so openDialog() is the last
 * thing this handler does. Anything slow placed before it is how a dialog silently fails
 * to appear.
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import {config} from '../config.js'
import {openDialog} from '../lib/mattermost.js'
import type {Dialog, PostActionIntegrationRequest, PostActionIntegrationResponse} from '../lib/types.js'

export async function handlePostAction(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as PostActionIntegrationRequest

    // There is no token on this surface. Mattermost authenticates the exchange through
    // trigger_id, which it issued and which expires on its own.
    req.log.info({user: payload.user_id, post: payload.post_id}, 'escalate clicked')

    const context = payload.context ?? {}

    const dialog: Dialog = {
        callback_id: 'escalate',
        title: 'Escalate alert',
        introduction_text: `Escalating ${String(context.indicator ?? 'this alert')} to the on-call team.`,
        submit_label: 'Escalate',
        notify_on_cancel: false,

        // `state` round trips to the submission handler unchanged, which makes it the
        // right place to carry the id of the alert being escalated. Without it the
        // submission has no idea which post it came from.
        state: payload.post_id,

        elements: [
            {
                display_name: 'Severity',
                name: 'severity',
                type: 'select',
                help_text: 'Your assessment, which may differ from the feed severity.',
                default: typeof context.severity === 'string' ? context.severity : undefined,
                options: [
                    {text: 'CRITICAL', value: 'CRITICAL'},
                    {text: 'HIGH', value: 'HIGH'},
                    {text: 'MEDIUM', value: 'MEDIUM'},
                ],
            },
            {
                display_name: 'Affected Systems',
                name: 'affected_systems',
                type: 'text',
                placeholder: 'DC-02, FIN-WKS-114',
                help_text: 'Hosts or services known to be involved.',
            },
            {
                display_name: 'Assignee',
                name: 'assignee',
                type: 'text',
                placeholder: 'username',
                help_text: 'Who is picking this up.',
            },
            {
                display_name: 'Notes',
                name: 'notes',
                type: 'textarea',
                optional: true,
                placeholder: 'What you have already ruled out.',
            },
        ],
    }

    try {
        await openDialog({
            trigger_id: payload.trigger_id,
            url: `${config.publicBaseUrl}/dialogs/escalate/submit`,
            dialog,
        })
    } catch (err) {
        req.log.error({err}, 'openDialog failed')
        return reply.send({
            ephemeral_text: `Could not open the escalation form: ${(err as Error).message}`,
        } satisfies PostActionIntegrationResponse)
    }

    // An empty response leaves the post as it is, which is what we want: the dialog is
    // already on screen and there is nothing to say in the channel.
    return reply.send({} satisfies PostActionIntegrationResponse)
}
