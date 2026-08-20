/**
 * Token verification. Pre-wired, you should not need to change it.
 *
 * Mattermost authenticates outgoing webhooks and slash commands with a shared token sent
 * in the request body. There is no HMAC signature header and nothing to recompute, so
 * comparing this token correctly is the entire security model for these surfaces.
 *
 * Use timingSafeEqualString rather than `===`. A plain string comparison returns as soon
 * as it finds a differing byte, so how long it takes leaks how much of the token an
 * attacker guessed correctly. That is enough to recover a token one byte at a time.
 */

import {timingSafeEqual} from 'node:crypto'

export function timingSafeEqualString(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8')
    const bufB = Buffer.from(b, 'utf8')

    // timingSafeEqual throws on a length mismatch, so that case is handled separately.
    // Returning early here leaks only the token's length, which is fixed and public.
    // What matters is that two tokens of equal length always cost the same to compare.
    if (bufA.length !== bufB.length) {
        return false
    }
    return timingSafeEqual(bufA, bufB)
}

/**
 * Checks a request token against the configured value.
 *
 * Returns false when the expected token is unset, so a misconfigured environment fails
 * closed rather than accepting everything.
 */
export function isValidToken(received: string | undefined, expected: string): boolean {
    if (!expected || !received) {
        return false
    }
    return timingSafeEqualString(received, expected)
}
