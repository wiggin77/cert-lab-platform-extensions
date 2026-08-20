/**
 * The payloads Mattermost sends you, and the ones it expects back.
 *
 * These are transcribed from the Mattermost source (server/public/model), not from
 * documentation, so the field names are exactly what arrives on the wire. File references
 * are in the comments if you want to read the originals.
 */

// ---------------------------------------------------------------------------
// Inbound: what Mattermost sends
// ---------------------------------------------------------------------------

/**
 * Slash command request. Arrives as application/x-www-form-urlencoded.
 * Source: channels/app/command.go
 */
export type SlashCommandRequest = {
    token: string
    team_id: string
    team_domain: string
    channel_id: string
    channel_name: string
    user_id: string
    user_name: string
    /** The trigger with its leading slash, for example "/threat". */
    command: string
    /** Everything after the trigger. Your parameters live here. */
    text: string
    /** Short lived. Required to open a dialog, and only valid for a few seconds. */
    trigger_id: string
    root_id: string
    /** Short lived URL for delayed responses, no bot token needed. */
    response_url: string
}

/**
 * Outgoing webhook payload.
 * Source: public/model/outgoing_webhook.go
 */
export type OutgoingWebhookPayload = {
    token: string
    team_id: string
    team_domain: string
    channel_id: string
    channel_name: string
    timestamp: number
    user_id: string
    user_name: string
    /** Id of the message that tripped the trigger word. Use it to build a permalink. */
    post_id: string
    text: string
    trigger_word: string
    file_ids: string
}

/**
 * Post action callback, sent when a user clicks a button or picks from a menu.
 * Source: public/model/integration_action.go
 */
export type PostActionIntegrationRequest = {
    user_id: string
    user_name: string
    channel_id: string
    channel_name: string
    team_id: string
    team_domain: string
    post_id: string
    /** Required to open a dialog. Short lived, so use it immediately. */
    trigger_id: string
    type: string
    data_source: string
    /** Whatever you put in the action's integration.context when you built the button. */
    context?: Record<string, unknown>
}

/**
 * Dialog submission.
 * Source: public/model/integration_action.go
 */
export type SubmitDialogRequest = {
    type: string
    url?: string
    callback_id: string
    /** Opaque string you set when opening the dialog. Round trips unchanged. */
    state: string
    user_id: string
    channel_id: string
    team_id: string
    /** Keyed by each element's name. */
    submission: Record<string, unknown>
    cancelled: boolean
    file_ids?: string[]
}

// ---------------------------------------------------------------------------
// Outbound: what Mattermost expects back
// ---------------------------------------------------------------------------

/**
 * Slash command response.
 *
 * response_type is "in_channel" or "ephemeral" only. Anything else is rejected.
 * Source: public/model/command_response.go
 */
export type CommandResponse = {
    response_type?: 'in_channel' | 'ephemeral'
    text?: string
    username?: string
    channel_id?: string
    icon_url?: string
    type?: string
    props?: Record<string, unknown>
    goto_location?: string
    skip_slack_parsing?: boolean
    attachments?: MessageAttachment[]
    extra_responses?: CommandResponse[]
}

/**
 * Outgoing webhook response.
 * Source: public/model/outgoing_webhook.go
 */
export type OutgoingWebhookResponse = {
    text?: string
    username?: string
    icon_url?: string
    props?: Record<string, unknown>
    attachments?: MessageAttachment[]
    type?: string
    /** "comment" posts your reply into the triggering message's thread. */
    response_type?: 'comment'
}

/**
 * Post action response.
 * Source: public/model/integration_action.go
 */
export type PostActionIntegrationResponse = {
    /** Replaces the post the button lives on. */
    update?: Record<string, unknown>
    /** Shows a message only the clicking user sees. */
    ephemeral_text?: string
    goto_location?: string
    skip_slack_parsing?: boolean
}

/**
 * Dialog submission response.
 *
 * Return `errors` keyed by element name to reject specific fields and keep the dialog
 * open. Return an empty object to accept and close it.
 * Source: public/model/integration_action.go
 */
export type SubmitDialogResponse = {
    /** Form level error. */
    error?: string
    /** Field level errors, keyed by element name. */
    errors?: Record<string, string>
    type?: 'ok' | 'form' | 'navigate'
    form?: Dialog
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

export type DialogElement = {
    display_name: string
    /** The key this element's value appears under in submission. */
    name: string
    type: 'text' | 'textarea' | 'select' | 'bool' | 'radio'
    subtype?: string
    default?: string
    placeholder?: string
    help_text?: string
    optional?: boolean
    min_length?: number
    max_length?: number
    data_source?: 'users' | 'channels'
    options?: Array<{text: string; value: string}>
}

export type Dialog = {
    callback_id: string
    title: string
    introduction_text?: string
    icon_url?: string
    elements: DialogElement[]
    submit_label?: string
    notify_on_cancel?: boolean
    /** Opaque string round tripped to your submission handler. */
    state?: string
}

export type OpenDialogRequest = {
    trigger_id: string
    /** Where Mattermost POSTs the submission. */
    url: string
    dialog: Dialog
}

// ---------------------------------------------------------------------------
// Message attachments and actions
// ---------------------------------------------------------------------------

export type MessageAttachmentField = {
    title: string
    value: string
    /** Two short fields sit side by side. */
    short?: boolean
}

export type PostAction = {
    id?: string
    type?: 'button' | 'select'
    name: string
    style?: 'default' | 'primary' | 'success' | 'good' | 'warning' | 'danger' | string
    disabled?: boolean
    options?: Array<{text: string; value: string}>
    integration: {
        /** Your callback URL. */
        url: string
        /** Arbitrary data returned to you on click. Not visible to the user. */
        context?: Record<string, unknown>
    }
}

export type MessageAttachment = {
    /** Plain text used in notifications and by clients that cannot render attachments. */
    fallback?: string
    /** Colour bar down the left edge. Hex, for example "#d24b4e". */
    color?: string
    pretext?: string
    author_name?: string
    author_link?: string
    author_icon?: string
    title?: string
    title_link?: string
    text?: string
    fields?: MessageAttachmentField[]
    footer?: string
    footer_icon?: string
    actions?: PostAction[]
}

/** Body accepted by an incoming webhook. Source: public/model/incoming_webhook.go */
export type IncomingWebhookRequest = {
    text: string
    username?: string
    icon_url?: string
    icon_emoji?: string
    channel?: string
    root_id?: string
    props?: Record<string, unknown>
    attachments?: MessageAttachment[]
    type?: string
}

// ---------------------------------------------------------------------------
// Lab domain
// ---------------------------------------------------------------------------

export type Severity = 'CRITICAL' | 'HIGH' | 'INFO'

export type Alert = {
    id: string
    severity: Severity
    source: string
    indicator: string
    indicatorType: 'ipv4' | 'domain' | 'sha256'
    title: string
    detail: string
}

/** A record from the mock threat intel API. */
export type IntelRecord = {
    indicator: string
    indicator_type: 'ipv4' | 'domain' | 'sha256'
    malware_family: string
    confidence: number
    last_seen: string
    campaigns: string[]
}
