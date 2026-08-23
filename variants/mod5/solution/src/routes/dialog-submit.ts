/**
 * MODULE 4 SOLUTION  ·  Dialog Submission
 *
 * Applied by the Instruqt solve script, and run against the Module 4 checks in CI.
 *
 * Validation happens here rather than after posting, because the protocol supports it:
 * returning `errors` keyed by element name keeps the dialog open with the message under
 * the offending field, so the analyst never loses what they typed.
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import {config} from '../config.js'
import {attachment, code, field} from '../lib/attachments.js'
import {createPost, createReply, permalink} from '../lib/mattermost.js'
import type {SubmitDialogRequest, SubmitDialogResponse} from '../lib/types.js'

/** Trims a submitted value to a string, whatever Mattermost sent. */
function str(value: unknown): string {
    return typeof value === 'string' ? value.trim() : ''
}

export async function handleDialogSubmit(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as SubmitDialogRequest

    if (payload.cancelled) {
        req.log.info({user: payload.user_id}, 'escalation cancelled')
        return reply.send({} satisfies SubmitDialogResponse)
    }

    const severity = str(payload.submission.severity)
    const affected = str(payload.submission.affected_systems)
    const assignee = str(payload.submission.assignee)
    const notes = str(payload.submission.notes)

    // Errors are keyed by each element's `name`, not its `display_name`. Getting that
    // wrong produces validation that silently never appears.
    const errors: Record<string, string> = {}
    if (!severity) {
        errors.severity = 'Choose a severity before escalating.'
    }
    if (!affected) {
        errors.affected_systems = 'Name at least one affected system.'
    }

    if (Object.keys(errors).length > 0) {
        // 200 with errors, not a 4xx. A non-2xx shows a generic failure and discards the
        // analyst's input.
        return reply.send({errors} satisfies SubmitDialogResponse)
    }

    // The originating post id round tripped through the dialog's `state`.
    const originalPostId = payload.state
    const escalatedAt = new Date().toISOString()

    // SubmitDialogRequest carries user_id but no username, so the id is what identifies
    // the analyst here. Looking the name up over the API would read better in a real
    // deployment.
    await createPost({
        channel_id: config.channels.incidents,
        message: '',
        attachments: [
            attachment({
                severity,
                title: `Escalated by analyst: ${severity}`,
                text: 'An analyst escalated this alert manually, with their own assessment attached.',
                fields: [
                    field('Severity', severity),
                    field('Affected Systems', affected),
                    field('Assignee', assignee || 'Unassigned'),
                    field('Escalated By', code(payload.user_id)),
                    field('Escalated At', escalatedAt),
                    field('Notes', notes || 'None provided', false),
                    // Threads cannot span channels, so the link back to #alerts is a
                    // permalink rather than a root_id.
                    field('Original Alert', permalink(originalPostId), false),
                ],
                footer: 'Manual escalation, certification lab',
                fallback: `[${severity}] escalation by ${payload.user_id}: ${affected}`,
            }),
        ],
    })

    // A threaded confirmation in #alerts, so anyone reading the original alert can see it
    // has been picked up. Optional, but it closes the loop where the analyst is looking.
    try {
        await createReply(
            originalPostId,
            payload.channel_id,
            `Escalated to ~incidents as **${severity}**, assigned to ${assignee || 'nobody yet'}.`,
        )
    } catch (err) {
        req.log.warn({err}, 'could not post the threaded confirmation')
    }

    // An empty object accepts the submission and closes the dialog.
    return reply.send({} satisfies SubmitDialogResponse)
}
