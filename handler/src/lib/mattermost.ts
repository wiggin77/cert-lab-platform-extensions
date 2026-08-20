/**
 * Mattermost REST client. Pre-wired, you should not need to change it.
 *
 * Every call goes to config.mattermostUrl, which points at the lab service. That forwards
 * to Mattermost and records the exchange so you can see it in the Lab Inspector. It does
 * not modify your request, and it does not add credentials: the Authorization header below
 * is yours.
 */

import {config} from '../config.js'
import type {MessageAttachment, OpenDialogRequest} from './types.js'

export class MattermostError extends Error {
    constructor(
        readonly status: number,
        readonly body: unknown,
    ) {
        super(`Mattermost returned ${status}: ${JSON.stringify(body)}`)
        this.name = 'MattermostError'
    }
}

export type Post = {
    id: string
    create_at: number
    user_id: string
    channel_id: string
    root_id: string
    message: string
    type: string
    props: Record<string, unknown>
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${config.mattermostUrl}/api/v4${path}`, {
        method,
        headers: {
            authorization: `Bearer ${config.botToken}`,
            ...(body === undefined ? {} : {'content-type': 'application/json'}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
    })

    const text = await res.text()
    const parsed = text ? JSON.parse(text) : null

    if (!res.ok) {
        throw new MattermostError(res.status, parsed)
    }
    return parsed as T
}

/**
 * Creates a post.
 *
 * Attachments go in props.attachments, not at the top level. This trips people up: the
 * incoming webhook API takes `attachments` directly, but the REST API nests them.
 */
export function createPost(post: {
    channel_id: string
    message: string
    root_id?: string
    attachments?: MessageAttachment[]
    props?: Record<string, unknown>
}): Promise<Post> {
    const {attachments, props, ...rest} = post
    return call<Post>('POST', '/posts', {
        ...rest,
        props: {...(props ?? {}), ...(attachments ? {attachments} : {})},
    })
}

/**
 * Replies in a thread.
 *
 * Threads cannot span channels. A reply always lands in the same channel as its root, so
 * you cannot thread a post in #incidents under an alert in #alerts. Use a permalink for
 * that instead, see permalink() below.
 */
export function createReply(
    rootPostId: string,
    channelId: string,
    message: string,
    attachments?: MessageAttachment[],
): Promise<Post> {
    return createPost({channel_id: channelId, root_id: rootPostId, message, attachments})
}

export function getPost(postId: string): Promise<Post> {
    return call<Post>('GET', `/posts/${postId}`)
}

/**
 * Opens an interactive dialog.
 *
 * The trigger_id must come from a slash command or a post action callback, and it expires
 * within seconds. Fetch what you need first, then open the dialog last.
 */
export function openDialog(request: OpenDialogRequest): Promise<void> {
    return call<void>('POST', '/actions/dialogs/open', request)
}

/** Builds a link to a specific post. This is how you point across channels. */
export function permalink(postId: string): string {
    return `${config.siteUrl}/${config.teamName}/pl/${postId}`
}
