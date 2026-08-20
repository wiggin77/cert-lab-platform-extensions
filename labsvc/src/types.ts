/**
 * Shared types.
 *
 * The Mattermost payload shapes below are transcribed from
 * mattermost/server/public/model, not from documentation. See DESIGN.md appendix A for
 * the file and line references.
 */

export type JournalKind =
    | 'mm_to_handler'
    | 'handler_to_mm'
    | 'delayed_response'
    | 'feed_fire'
    | 'intel_query'
    | 'llm_call'
    | 'grader_stimulus'
    | 'grader_assert'
    | 'admin'

export type CapturedMessage = {
    method?: string
    status?: number
    headers: Record<string, string>
    /** Parsed body when the content type was understood, otherwise a raw string. */
    body: unknown
    /** Set when the body exceeded config.journal.maxBodyBytes and was cut. */
    truncated?: boolean
}

export type JournalEvent = {
    seq: number
    ts: string
    module: number
    kind: JournalKind
    route: string
    request: CapturedMessage
    response?: CapturedMessage
    durationMs?: number
    correlationId: string
    /** Free form annotations the proxy or grader attach, surfaced in the inspector. */
    notes?: string[]
    prevHash: string
    hash: string
}

/** Event as supplied by a caller, before the journal assigns identity and hashes. */
export type JournalInput = Omit<JournalEvent, 'seq' | 'ts' | 'prevHash' | 'hash' | 'module'> & {
    module?: number
}

// ---------------------------------------------------------------------------
// Mattermost integration payloads
// ---------------------------------------------------------------------------

/** channels/app/command.go:487, sent as application/x-www-form-urlencoded. */
export type SlashCommandRequest = {
    token: string
    team_id: string
    team_domain: string
    channel_id: string
    channel_name: string
    user_id: string
    user_name: string
    command: string
    text: string
    trigger_id: string
    root_id: string
    response_url: string
}

/** public/model/outgoing_webhook.go:54 */
export type OutgoingWebhookPayload = {
    token: string
    team_id: string
    team_domain: string
    channel_id: string
    channel_name: string
    timestamp: number
    user_id: string
    user_name: string
    post_id: string
    text: string
    trigger_word: string
    file_ids: string
}

/** public/model/integration_action.go:415 */
export type PostActionIntegrationRequest = {
    user_id: string
    user_name: string
    channel_id: string
    channel_name: string
    team_id: string
    team_domain: string
    post_id: string
    trigger_id: string
    type: string
    data_source: string
    context?: Record<string, unknown>
}

/** public/model/integration_action.go:548 */
export type SubmitDialogRequest = {
    type: string
    url?: string
    callback_id: string
    state: string
    user_id: string
    channel_id: string
    team_id: string
    submission: Record<string, unknown>
    cancelled: boolean
    file_ids?: string[]
}

/** public/model/integration_action.go:475 */
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
    data_source?: 'users' | 'channels'
    options?: Array<{text: string; value: string}>
}

/** public/model/integration_action.go:446 */
export type Dialog = {
    callback_id: string
    title: string
    introduction_text?: string
    icon_url?: string
    elements: DialogElement[]
    submit_label?: string
    notify_on_cancel?: boolean
    state?: string
}

/** public/model/incoming_webhook.go:52 */
export type IncomingWebhookRequest = {
    text: string
    username?: string
    icon_url?: string
    channel?: string
    root_id?: string
    props?: Record<string, unknown>
    attachments?: MessageAttachment[]
    type?: string
    icon_emoji?: string
}

export type MessageAttachmentField = {
    title: string
    value: string
    short?: boolean
}

export type MessageAttachment = {
    fallback?: string
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
    actions?: unknown[]
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

export type IntelRecord = {
    indicator: string
    indicator_type: 'ipv4' | 'domain' | 'sha256'
    malware_family: string
    confidence: number
    last_seen: string
    campaigns: string[]
}

export type FeedTransport = 'incoming_webhook' | 'bot_rest'
