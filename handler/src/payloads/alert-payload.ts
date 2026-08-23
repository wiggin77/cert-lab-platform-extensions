/**
 * MODULE 1  ·  Incoming Webhooks
 *
 * The threat feed calls this function for every alert, then POSTs whatever you return to
 * the incoming webhook you created in Mattermost.
 *
 * Right now it returns plain text, which is why alerts show up in #alerts as an
 * unformatted line. Your job is to return a properly formatted message attachment.
 *
 * WHAT THE CHECK LOOKS FOR
 *   1. An attachment, not just text
 *   2. Fields titled exactly: Severity, Source, Indicator, Timestamp
 *   3. A colour bar that varies by severity: red CRITICAL, amber HIGH, blue INFO
 *   4. Non-empty fallback text, so notifications are not blank
 *
 * USEFUL HELPERS  (import them, or write it all by hand if you prefer)
 *   attachment(), field(), code(), severityColor()   from ../lib/attachments.js
 *
 * TRY IT
 *   fire-alert.sh --severity CRITICAL
 *   then watch #alerts, and check the Lab Inspector if nothing arrives.
 */

// Uncomment this together with the sample below. The helpers are values, not types, so
// they need a plain import rather than `import type`, and the extension is `.js` even
// though the file is `.ts`, which is how ES modules resolve on Node.
// import {attachment, code, field} from '../lib/attachments.js'
import type {Alert, IncomingWebhookRequest} from '../lib/types.js'

export function buildAlertPayload(alert: Alert): IncomingWebhookRequest {
    // TODO Module 1: replace this with a formatted attachment.
    //
    // Something along these lines, once you fill in the gaps. Uncomment the import above
    // at the same time, or `attachment` and `field` will be undefined names.
    //
    //   return {
    //       text: '',
    //       username: 'Threat Feed',
    //       icon_emoji: 'rotating_light',
    //       attachments: [
    //           attachment({
    //               severity: alert.severity,
    //               title: alert.title,
    //               text: alert.detail,
    //               fields: [
    //                   field('Severity', alert.severity),
    //                   // ... Source, Indicator and Timestamp go here.
    //                   // code() renders a value as inline code, which suits an indicator.
    //               ],
    //               footer: 'Simulated feed',
    //           }),
    //       ],
    //   }
    //
    // Note that `text` can be empty when you supply an attachment. Note also that an
    // alert's timestamp is the moment it fires, so generate it here.

    return {
        text: `[${alert.severity}] ${alert.title} ${alert.indicator} from ${alert.source}`,
    }
}
