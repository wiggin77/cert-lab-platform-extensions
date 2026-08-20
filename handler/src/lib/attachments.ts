/**
 * Attachment helpers. Pre-wired, you should not need to change them.
 *
 * The attachment format is the same across incoming webhooks, outgoing webhook responses,
 * slash command responses, and REST posts. Learn it once and it transfers everywhere.
 */

import type {MessageAttachment, MessageAttachmentField, PostAction, Severity} from './types.js'

/** Colour bar per severity: red for CRITICAL, amber for HIGH, blue for INFO. */
export const SEVERITY_COLORS: Record<Severity, string> = {
    CRITICAL: '#d24b4e',
    HIGH: '#f5ab00',
    INFO: '#1c58d9',
}

export function severityColor(severity: string): string {
    return SEVERITY_COLORS[severity as Severity] ?? '#8b9198'
}

/** Two short fields render side by side, which is usually what you want for metadata. */
export function field(title: string, value: string, short = true): MessageAttachmentField {
    return {title, value, short}
}

/** Wraps a value in backticks so indicators are not mangled by markdown. */
export function code(value: string): string {
    return `\`${value}\``
}

export function button(
    name: string,
    url: string,
    context: Record<string, unknown> = {},
    style: PostAction['style'] = 'default',
): PostAction {
    return {type: 'button', name, style, integration: {url, context}}
}

/**
 * Builds an attachment with a sensible fallback.
 *
 * fallback is what appears in push notifications and in clients that cannot render
 * attachments. Leaving it empty means a silent, blank notification, which is the most
 * commonly missed part of the format.
 */
export function attachment(spec: {
    severity?: Severity | string
    title?: string
    titleLink?: string
    text?: string
    fields?: MessageAttachmentField[]
    footer?: string
    actions?: PostAction[]
    fallback?: string
}): MessageAttachment {
    const fallback =
        spec.fallback ??
        [spec.severity ? `[${spec.severity}]` : '', spec.title ?? '', spec.text ?? ''].filter(Boolean).join(' ').trim()

    return {
        fallback: fallback || 'Alert',
        ...(spec.severity ? {color: severityColor(String(spec.severity))} : {}),
        ...(spec.title ? {title: spec.title} : {}),
        ...(spec.titleLink ? {title_link: spec.titleLink} : {}),
        ...(spec.text ? {text: spec.text} : {}),
        ...(spec.fields ? {fields: spec.fields} : {}),
        ...(spec.footer ? {footer: spec.footer} : {}),
        ...(spec.actions ? {actions: spec.actions} : {}),
    }
}
