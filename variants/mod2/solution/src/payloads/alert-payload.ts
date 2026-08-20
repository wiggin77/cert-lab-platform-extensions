/**
 * MODULE 2 SOLUTION  ·  Incoming Webhooks
 *
 * Applied by the Instruqt solve script, and run against the Module 2 checks in CI.
 */

import {attachment, code, field} from '../lib/attachments.js'
import type {Alert, IncomingWebhookRequest} from '../lib/types.js'

export function buildAlertPayload(alert: Alert): IncomingWebhookRequest {
    return {
        // An attachment carries the content, so the top level text can stay empty.
        text: '',
        username: 'Threat Feed',
        icon_emoji: 'rotating_light',
        attachments: [
            attachment({
                // severity drives the colour bar: red CRITICAL, amber HIGH, blue INFO.
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
                // Set explicitly rather than relying on the default, so notifications read
                // well on a phone lock screen.
                fallback: `[${alert.severity}] ${alert.title} (${alert.indicator})`,
            }),
        ],
    }
}
