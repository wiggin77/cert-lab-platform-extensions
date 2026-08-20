/**
 * Reading alert data back out of a post. Pre-wired, you should not need to change it.
 *
 * An alert arrives in #alerts as a message attachment. To act on it in Modules 3 and 5 you
 * have to get the structured fields back out, which means reading props.attachments.
 */

import type {MessageAttachment, Severity} from './types.js'

export type ParsedAlert = {
    severity: Severity | null
    source: string | null
    indicator: string | null
    timestamp: string | null
    title: string | null
}

function attachmentsOf(props: Record<string, unknown> | undefined): MessageAttachment[] {
    const raw = props?.attachments
    return Array.isArray(raw) ? (raw as MessageAttachment[]) : []
}

function fieldValue(attachment: MessageAttachment, name: string): string | null {
    const match = (attachment.fields ?? []).find((f) => (f.title ?? '').trim().toLowerCase() === name.toLowerCase())
    if (!match) {
        return null
    }
    // Values are often wrapped in backticks or bold markers for display.
    return String(match.value ?? '')
        .replace(/^[`*_\s]+|[`*_\s]+$/g, '')
        .trim()
}

/** Pulls the four alert fields out of a post's first attachment. */
export function parseAlertFromProps(props: Record<string, unknown> | undefined): ParsedAlert {
    const attachment = attachmentsOf(props)[0]
    if (!attachment) {
        return {severity: null, source: null, indicator: null, timestamp: null, title: null}
    }

    const severity = fieldValue(attachment, 'Severity')
    return {
        severity: severity ? (severity.toUpperCase() as Severity) : null,
        source: fieldValue(attachment, 'Source'),
        indicator: fieldValue(attachment, 'Indicator'),
        timestamp: fieldValue(attachment, 'Timestamp'),
        title: attachment.title ?? null,
    }
}

/**
 * Last resort extraction from raw message text.
 *
 * Useful when a post has no attachment, for example while you are still working on
 * Module 2's payload.
 */
export function extractIndicator(text: string): string | null {
    const patterns = [
        /\b[a-f0-9]{64}\b/i, // sha256
        /\b(?:\d{1,3}\.){3}\d{1,3}\b/, // ipv4
        /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+\b/i, // domain
    ]
    for (const pattern of patterns) {
        const match = pattern.exec(text)
        if (match) {
            return match[0]
        }
    }
    return null
}
