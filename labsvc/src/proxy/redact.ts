/**
 * Redaction for the inspector UI only.
 *
 * The journal deliberately retains token values in full, because Module 3's whole lesson
 * is token validation and the grader has to be able to tell a good token from a bad one.
 * Redaction happens on the way out to the browser, never on the way in to the journal.
 */

const SECRET_KEYS = new Set([
    'token',
    'authorization',
    'password',
    'api_key',
    'apikey',
    'client_secret',
    'access_token',
    'mm_bot_token',
])

/** Keeps enough of the value to eyeball a mismatch without printing the secret. */
function mask(value: string): string {
    if (value.length <= 8) {
        return '*'.repeat(value.length)
    }
    return `${value.slice(0, 4)}...${value.slice(-4)} (${value.length} chars)`
}

export function redact(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(redact)
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (SECRET_KEYS.has(k.toLowerCase()) && typeof v === 'string') {
                out[k] = mask(v)
            } else {
                out[k] = redact(v)
            }
        }
        return out
    }
    return value
}
