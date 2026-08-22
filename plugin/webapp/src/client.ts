/**
 * HTTP client for the plugin's own endpoints.
 *
 * The webapp and the server half are separate processes. The webapp cannot read the KV
 * Store, so every field it displays arrives through one of these calls.
 *
 * Two things to note about the fetch options:
 *
 *   - `credentials: 'same-origin'` sends the session cookie, which is what makes the
 *     server side see a Mattermost-User-Id. Without it every request is unauthorized.
 *   - `X-Requested-With` is required by the server's CSRF protection for cookie
 *     authenticated requests that are not GETs.
 */

import type {AlertCount, AlertRecord} from './types';

/** Exported because the plugin's redux state is keyed by it. See registerReducer. */
export const PLUGIN_ID = 'com.mattermost.cert-alerts';

/** Plugin endpoints hang off the root, not off /api/v4. */
const BASE = `/plugins/${PLUGIN_ID}/api/v1`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(options.headers ?? {}),
        },
        ...options,
    });

    if (!response.ok) {
        // Surface the server's message rather than a bare status. The endpoints return
        // {"error": "..."} so there is usually something specific to show.
        let detail = `${response.status} ${response.statusText}`;
        try {
            const body = await response.json();
            if (body?.error) {
                detail = body.error;
            }
        } catch {
            // Not JSON, so the status is all there is.
        }
        throw new Error(detail);
    }

    return response.json() as Promise<T>;
}

export function fetchAlert(postId: string): Promise<AlertRecord> {
    return request<AlertRecord>(`/alert/${postId}`);
}

export function setAlertStatus(postId: string, status: string): Promise<AlertRecord> {
    return request<AlertRecord>(`/alert/${postId}/status`, {
        method: 'POST',
        body: JSON.stringify({status}),
    });
}

export function fetchOpenCount(): Promise<AlertCount> {
    return request<AlertCount>('/alerts/count');
}

/** Runs an AI skill against an alert. The reply is posted server side, in thread. */
export function analyzeAlert(postId: string, skill: string): Promise<{posted?: boolean}> {
    return request(`/alert/${postId}/analyze`, {
        method: 'POST',
        body: JSON.stringify({skill}),
    });
}
