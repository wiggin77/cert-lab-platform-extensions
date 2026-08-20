/**
 * Configuration, read from .env by the lab environment.
 *
 * You should not need to change anything in this file. If a value is missing at runtime
 * the handler tells you which one and keeps running, so a single missing variable does not
 * stop you working on an unrelated module.
 */

function env(name: string, fallback = ''): string {
    return process.env[name] ?? fallback
}

export const config = {
    port: Number.parseInt(env('PORT', '3000'), 10),

    /**
     * Base URL for the Mattermost REST API.
     *
     * This points at the lab service, which forwards to Mattermost and records the
     * exchange so you can see it in the Lab Inspector. It is a plain pass through: you
     * still send your own Authorization header, exactly as you would in production.
     */
    mattermostUrl: env('MM_URL', 'http://workbench:4000/mm'),

    /** Site URL, used to build permalinks. Not an API base. */
    siteUrl: env('MM_SITE_URL', 'http://mattermost:8065'),

    /** Bot token. Send it as `Authorization: Bearer <token>`. */
    botToken: env('MM_BOT_TOKEN'),

    teamName: env('MM_TEAM_NAME', 'soc'),

    channels: {
        alerts: env('MM_ALERTS_CHANNEL_ID'),
        incidents: env('MM_INCIDENTS_CHANNEL_ID'),
    },

    /**
     * Tokens Mattermost sends with each request.
     *
     * Mattermost authenticates outgoing webhooks and slash commands with a shared token in
     * the request body. There is no signature header, so comparing this value correctly is
     * the whole of the security model. See lib/verify.ts.
     */
    outgoingWebhookToken: env('MM_OUTGOING_WEBHOOK_TOKEN'),
    commandToken: env('MM_COMMAND_TOKEN'),

    /** Mock threat intel API, Module 4. */
    intelApiUrl: env('INTEL_API_URL', 'http://workbench:4000/mock/intel/v1'),

    /** Where your integration callback URLs live, used when building dialog URLs. */
    publicBaseUrl: env('LABSVC_PUBLIC_BASE_URL', 'http://workbench:4000'),
} as const

/** Names the variables a given module needs, so a missing one fails loudly and early. */
export function warnMissing(log: {warn: (msg: string) => void}): void {
    const required: Array<[string, string]> = [
        ['MM_BOT_TOKEN', config.botToken],
        ['MM_ALERTS_CHANNEL_ID', config.channels.alerts],
        ['MM_INCIDENTS_CHANNEL_ID', config.channels.incidents],
    ]
    for (const [name, value] of required) {
        if (!value) {
            log.warn(`${name} is not set. Anything that needs it will fail until the lab sets it.`)
        }
    }
}
