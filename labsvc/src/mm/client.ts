/**
 * Minimal Mattermost REST client for labsvc's own use.
 *
 * Used by the mock feed (bot token) and by the grader (admin token). This is deliberately
 * not the client the learner uses. Theirs lives in the handler repo and is part of what
 * they are learning. Keeping the two separate means a learner breaking their client cannot
 * break grading.
 */

import {config} from '../config.js'
import type {IncomingWebhookRequest, MessageAttachment} from '../types.js'

export class MattermostError extends Error {
    constructor(
        readonly status: number,
        readonly body: unknown,
        message: string,
    ) {
        super(message)
        this.name = 'MattermostError'
    }
}

export type Post = {
    id: string
    create_at: number
    update_at: number
    delete_at: number
    user_id: string
    channel_id: string
    root_id: string
    message: string
    type: string
    props: Record<string, unknown>
}

export class MattermostClient {
    constructor(
        private readonly token: string,
        private readonly baseUrl: string = config.mattermostUrl,
    ) {}

    async request<T>(method: string, path: string, body?: unknown): Promise<T> {
        const res = await fetch(`${this.baseUrl}/api/v4${path}`, {
            method,
            headers: {
                authorization: `Bearer ${this.token}`,
                ...(body === undefined ? {} : {'content-type': 'application/json'}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(15_000),
        })

        const text = await res.text()
        const parsed = text ? safeJson(text) : null

        if (!res.ok) {
            throw new MattermostError(res.status, parsed, `${method} ${path} returned ${res.status}`)
        }
        return parsed as T
    }

    createPost(post: {
        channel_id: string
        message: string
        root_id?: string
        type?: string
        props?: Record<string, unknown>
    }): Promise<Post> {
        return this.request<Post>('POST', '/posts', post)
    }

    getPost(id: string): Promise<Post> {
        return this.request<Post>('GET', `/posts/${id}`)
    }

    deletePost(id: string): Promise<unknown> {
        return this.request('DELETE', `/posts/${id}`)
    }

    /** Posts in a channel, newest first, as Mattermost orders them. */
    async getChannelPosts(channelId: string, opts: {since?: number; perPage?: number} = {}): Promise<Post[]> {
        const params = new URLSearchParams()
        if (opts.since !== undefined) {
            params.set('since', String(opts.since))
        }
        params.set('per_page', String(opts.perPage ?? 100))

        const page = await this.request<{order: string[]; posts: Record<string, Post>}>(
            'GET',
            `/channels/${channelId}/posts?${params}`,
        )
        return page.order.map((id) => page.posts[id]).filter((p): p is Post => p !== undefined)
    }

    /** Simulates a learner clicking an interactive button. Used by the grader as stimulus. */
    doPostAction(postId: string, actionId: string): Promise<{status: string; trigger_id: string}> {
        return this.request('POST', `/posts/${postId}/actions/${actionId}`, {})
    }

    getIncomingWebhooks(): Promise<Array<Record<string, unknown>>> {
        return this.request('GET', '/hooks/incoming?per_page=200')
    }

    getOutgoingWebhooks(): Promise<Array<Record<string, unknown>>> {
        return this.request('GET', '/hooks/outgoing?per_page=200')
    }

    getCommands(teamId: string): Promise<Array<Record<string, unknown>>> {
        return this.request('GET', `/commands?team_id=${teamId}&custom_only=true`)
    }

    getTeamByName(name: string): Promise<{id: string; name: string}> {
        return this.request('GET', `/teams/name/${name}`)
    }

    getMe(): Promise<{id: string; username: string}> {
        return this.request('GET', '/users/me')
    }

    /** Every post in a thread. Used to assert threaded replies. */
    async getPostThread(rootId: string): Promise<Post[]> {
        const thread = await this.request<{order: string[]; posts: Record<string, Post>}>(
            'GET',
            `/posts/${rootId}/thread`,
        )
        return thread.order.map((id) => thread.posts[id]).filter((p): p is Post => p !== undefined)
    }

    /**
     * Runs a slash command as this client's user.
     *
     * Returns the immediate CommandResponse, which is what the grader times against the
     * acknowledgment budget. Source: channels/api4/command.go:19
     */
    executeCommand(channelId: string, command: string): Promise<Record<string, unknown>> {
        return this.request('POST', '/commands/execute', {channel_id: channelId, command})
    }

    getPlugins(): Promise<{active: Array<{id: string; version: string}>; inactive: Array<{id: string}>}> {
        return this.request('GET', '/plugins')
    }

    /** Webapp manifests, including the hashed bundle_path. */
    getWebappPlugins(): Promise<Array<{id: string; webapp?: {bundle_path?: string}}>> {
        return this.request('GET', '/plugins/webapp')
    }

    /**
     * Calls a plugin's own HTTP endpoint.
     *
     * These live at /plugins/{plugin_id}/... on the root router, NOT under /api/v4.
     * Source: channels/app/channels.go:239
     */
    async pluginRequest<T>(
        pluginId: string,
        path: string,
        opts: {method?: string; body?: unknown} = {},
    ): Promise<{status: number; body: T | unknown}> {
        const res = await fetch(`${this.baseUrl}/plugins/${pluginId}${path}`, {
            method: opts.method ?? 'GET',
            headers: {
                authorization: `Bearer ${this.token}`,
                ...(opts.body === undefined ? {} : {'content-type': 'application/json'}),
            },
            body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
            signal: AbortSignal.timeout(20_000),
        })
        const text = await res.text()
        return {status: res.status, body: text ? safeJson(text) : null}
    }

    /** Fetches a path outside /api/v4, for example a static plugin bundle. */
    async fetchRaw(path: string): Promise<{status: number; text: string}> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            headers: {authorization: `Bearer ${this.token}`},
            signal: AbortSignal.timeout(20_000),
        })
        return {status: res.status, text: await res.text()}
    }
}

/** Posts to an incoming webhook URL. No auth, the URL is the credential. */
export async function postToIncomingWebhook(
    url: string,
    payload: IncomingWebhookRequest,
): Promise<{ok: boolean; status: number; body: string}> {
    const res = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
    })
    return {ok: res.ok, status: res.status, body: await res.text()}
}

export function permalink(siteUrl: string, teamName: string, postId: string): string {
    return `${siteUrl}/${teamName}/pl/${postId}`
}

export function attachmentOf(post: Post): MessageAttachment | undefined {
    const raw = post.props?.attachments
    return Array.isArray(raw) ? (raw[0] as MessageAttachment | undefined) : undefined
}

function safeJson(text: string): unknown {
    try {
        return JSON.parse(text)
    } catch {
        return text
    }
}
