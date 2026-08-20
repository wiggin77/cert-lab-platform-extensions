/**
 * Runtime configuration for labsvc.
 *
 * Everything is environment driven so the Instruqt track setup script is the single
 * place that knows about ids and tokens. Nothing here is read from disk at runtime.
 */

function str(name: string, fallback: string): string {
    const v = process.env[name]
    return v === undefined || v === '' ? fallback : v
}

function req(name: string): string {
    const v = process.env[name]
    if (v === undefined || v === '') {
        return ''
    }
    return v
}

function int(name: string, fallback: number): number {
    const v = process.env[name]
    if (v === undefined || v === '') {
        return fallback
    }
    const n = Number.parseInt(v, 10)
    return Number.isFinite(n) ? n : fallback
}

export const config = {
    /** Where labsvc itself listens. */
    host: str('LABSVC_HOST', '0.0.0.0'),
    port: int('LABSVC_PORT', 4000),

    /**
     * Base URL that Mattermost and the learner's handler use to reach labsvc.
     *
     * This must be an address reachable from the Mattermost *server* process, not from
     * the learner's browser. On Instruqt that is the internal host name, never the
     * public env.play.instruqt.com form. See DESIGN.md section 3.1.
     */
    publicBaseUrl: str('LABSVC_PUBLIC_BASE_URL', 'http://workbench:4000'),

    /** The learner's handler, the thing that breaks constantly by design. */
    handlerUrl: str('HANDLER_URL', 'http://127.0.0.1:3000'),

    /** Upstream Mattermost. */
    mattermostUrl: str('MM_URL', 'http://127.0.0.1:8065'),

    /** Admin token, used only by the grader and the seeder. Never exposed to the handler. */
    mattermostAdminToken: req('MM_ADMIN_TOKEN'),

    /** Bot token used by the mock feed when posting over REST. */
    feedBotToken: req('MM_FEED_BOT_TOKEN'),

    channels: {
        alerts: req('MM_ALERTS_CHANNEL_ID'),
        incidents: req('MM_INCIDENTS_CHANNEL_ID'),
    },

    team: {
        id: req('MM_TEAM_ID'),
        name: str('MM_TEAM_NAME', 'soc'),
    },

    /** Module 6. Must match the id in the plugin scaffold's plugin.json. */
    pluginId: str('LAB_PLUGIN_ID', 'com.mattermost.cert-alerts'),

    /** Incoming webhook the mock feed uses for Module 2 only. See DESIGN.md section 5.1. */
    feedIncomingWebhookUrl: req('MM_FEED_INCOMING_WEBHOOK_URL'),

    journal: {
        path: str('JOURNAL_PATH', '/var/lib/labsvc/journal.jsonl'),
        ringSize: int('JOURNAL_RING_SIZE', 500),
        /** Max bytes of a single request or response body retained in the journal. */
        maxBodyBytes: int('JOURNAL_MAX_BODY_BYTES', 64 * 1024),
    },

    feed: {
        intervalMs: int('FEED_INTERVAL_MS', 60_000),
        /** Seeded so the ambient alert sequence is reproducible per participant. */
        seed: int('FEED_SEED', 20260819),
        /** Ambient firing is off until the track setup script enables it. */
        autostart: str('FEED_AUTOSTART', 'false') === 'true',
    },

    /**
     * Budget for the learner's slash command acknowledgment.
     *
     * Keep this in sync with ServiceSettings.OutgoingIntegrationRequestsTimeout in the
     * lab's Mattermost config.json. The lab sets that to 5 seconds so the curriculum's
     * "5-second timeout" lesson is literally true. See DESIGN.md section 10.
     */
    slashAckBudgetMs: int('SLASH_ACK_BUDGET_MS', 3000),

    /** Timeout applied when labsvc calls the handler. Must exceed the Mattermost timeout. */
    handlerTimeoutMs: int('HANDLER_TIMEOUT_MS', 30_000),

    /** Current module, used to tag journal events and to pick feed transport. */
    module: int('LAB_MODULE', 2),

    logLevel: str('LOG_LEVEL', 'info'),
} as const

export type Config = typeof config
