/**
 * Error description.
 *
 * Node's fetch reports nearly every transport problem as the bare string "fetch failed"
 * and hides the real reason on err.cause. As a message shown to a learner in a check
 * result or an integration response, that is worse than useless: it names no cause and
 * suggests no action. Everything that surfaces a caught error to a human goes through
 * here first.
 */

export function causeCode(err: unknown): string | undefined {
    return (err as {cause?: {code?: string}})?.cause?.code
}

export function errorName(err: unknown): string {
    return err instanceof Error ? err.name : ''
}

export function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}

/**
 * Describes a failed network call in terms of what a reader can do about it.
 *
 * `target` should name the thing that was being called, for example
 * "Mattermost at http://workbench:8065".
 */
export function describeError(err: unknown, target: string, timeoutMs?: number): string {
    if (errorName(err) === 'TimeoutError' || errorName(err) === 'AbortError') {
        return timeoutMs ? `${target} did not respond within ${timeoutMs}ms` : `${target} did not respond in time`
    }

    switch (causeCode(err)) {
        case 'ECONNREFUSED':
            return `nothing is listening at ${target}`
        case 'ENOTFOUND':
        case 'EAI_AGAIN':
            return `the host name in ${target} does not resolve`
        case 'ECONNRESET':
            return `${target} closed the connection before replying, which usually means it crashed mid request`
        case 'UND_ERR_SOCKET':
            return `the connection to ${target} dropped`
        case 'CERT_HAS_EXPIRED':
        case 'DEPTH_ZERO_SELF_SIGNED_CERT':
            return `${target} presented a certificate that could not be verified`
        default: {
            const code = causeCode(err)
            return code ? `${errorMessage(err)} (${code}) calling ${target}` : errorMessage(err)
        }
    }
}
