/**
 * MODULE 5 SOLUTION  ·  the alert payload, now carrying an Escalate button
 *
 * Applied by the Instruqt solve script, and run against the Module 5 checks in CI.
 *
 * This is the Module 2 payload plus an `actions` array. Interactive elements are declared
 * in the message itself, so adding a button means changing whatever built the message,
 * which is why Module 5 comes back to this file.
 */

import {config} from '../config.js'
import {attachment, button, code, field} from '../lib/attachments.js'
import type {Alert, IncomingWebhookRequest} from '../lib/types.js'

export function buildAlertPayload(alert: Alert): IncomingWebhookRequest {
    return {
        text: '',
        username: 'Threat Feed',
        icon_emoji: 'rotating_light',
        attachments: [
            attachment({
                severity: alert.severity,
                title: alert.title,
                text: alert.detail,
                fields: [
                    field('Severity', alert.severity),
                    field('Source', alert.source),
                    field('Indicator', code(alert.indicator)),
                    field('Timestamp', new Date().toISOString()),
                ],
                footer: 'Simulated feed, certification lab',
                fallback: `[${alert.severity}] ${alert.title} (${alert.indicator})`,

                // The button's context is private data returned to the handler on click,
                // never shown to the user. The post id is deliberately absent: the post
                // does not exist yet when this runs, and Mattermost supplies `post_id` on
                // the callback anyway.
                actions: [
                    button(
                        'Escalate',
                        `${config.publicBaseUrl}/actions/escalate`,
                        {indicator: alert.indicator, severity: alert.severity, source: alert.source},
                        'danger',
                    ),
                ],
            }),
        ],
    }
}
