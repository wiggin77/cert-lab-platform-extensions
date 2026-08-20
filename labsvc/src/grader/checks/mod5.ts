/**
 * Module 5, post actions and dialogs.
 *
 * Stimulus for the button is POST /api/v4/posts/{post_id}/actions/{action_id}, which is
 * exactly what a real click does. Source: channels/api4/integration_action.go:17
 *
 * Dialog submissions are posted straight at the handler rather than driven through
 * Mattermost. A real submission needs a live trigger_id and an open modal, neither of
 * which a grader can hold, and the handler cannot tell the difference.
 *
 * One check here leans on the journal for something Mattermost state cannot show: opening
 * a dialog leaves no trace once the trigger expires. It degrades to a specific message
 * rather than a wrong failure when the evidence is missing.
 */

import {config} from '../../config.js'
import type {Post} from '../../mm/client.js'
import type {Dialog, DialogElement} from '../../types.js'
import {fail, pass, registerChallenge, type CheckContext, type CheckResult} from '../index.js'
import {attachmentText, firstAttachment, journalSince, looksLikeLeakedError, waitForAlertPost} from './shared.js'

type ActionSpec = {id?: string; name?: string; type?: string}

const REQUIRED_ELEMENTS: Array<{match: RegExp; label: string; type: DialogElement['type']}> = [
    {match: /sever/i, label: 'Severity', type: 'select'},
    {match: /affect|system/i, label: 'Affected Systems', type: 'text'},
    {match: /assign/i, label: 'Assignee', type: 'text'},
    {match: /note/i, label: 'Notes', type: 'textarea'},
]

const FALLBACK_NAMES = {
    severity: 'severity',
    affected: 'affected_systems',
    assignee: 'assignee',
    notes: 'notes',
}

function actionsOf(post: Post): ActionSpec[] {
    const raw = firstAttachment(post)?.actions
    return Array.isArray(raw) ? (raw as ActionSpec[]) : []
}

function findEscalateAction(post: Post): ActionSpec | undefined {
    return actionsOf(post).find((a) => /escalat/i.test(String(a.name ?? '')))
}

/** The most recent dialog the handler opened during this run, if it went through the proxy. */
function lastDialog(ctx: CheckContext): Dialog | null {
    const event = journalSince(ctx, 'handler_to_mm', '/api/v4/actions/dialogs/open').at(-1)
    const body = event?.request.body as {dialog?: Dialog} | undefined
    return body?.dialog ?? null
}

/** Maps a required field to the element name the learner actually used. */
function elementName(dialog: Dialog | null, match: RegExp, fallback: string): string {
    const element = (dialog?.elements ?? []).find(
        (e) => match.test(e.name ?? '') || match.test(e.display_name ?? ''),
    )
    return element?.name ?? fallback
}

async function fireAndFindAlert(ctx: CheckContext) {
    const since = Date.now() - 1000
    const fired = await ctx.feed.fire({severity: 'CRITICAL', runId: ctx.runId})
    const post = await waitForAlertPost(ctx, fired.alert, since)
    return {fired, post, since}
}

async function buttonPresent(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod5-button-present'
    const title = 'Alerts carry an Escalate button'

    const {post} = await fireAndFindAlert(ctx)
    if (!post) {
        return fail(id, title, 'The stimulus alert never appeared in #alerts.', 'Environment fault rather than a learner error.')
    }

    const actions = actionsOf(post)
    if (actions.length === 0) {
        return fail(
            id,
            title,
            'The alert attachment has no actions array.',
            'Add a button to the attachment you build in src/payloads/alert-payload.ts, using button() from lib/attachments.js pointing at ' +
                `${config.publicBaseUrl}/actions/escalate`,
        )
    }

    const escalate = findEscalateAction(post)
    if (!escalate) {
        return fail(
            id,
            title,
            `Found action(s) named: ${actions.map((a) => a.name).join(', ')}.`,
            'Name the button so it reads as an escalation, for example "Escalate".',
        )
    }

    return pass(id, title, `Alert ${post.id} carries an action named "${escalate.name}".`)
}

async function dialogOpens(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod5-dialog-opens'
    const title = 'Clicking Escalate opens a correctly defined dialog'

    const {post} = await fireAndFindAlert(ctx)
    const escalate = post ? findEscalateAction(post) : undefined

    if (!post || !escalate?.id) {
        return fail(id, title, 'No clickable Escalate action to test.', 'Fix the previous check first.')
    }

    let clickError: string | null = null
    try {
        await ctx.mm.doPostAction(post.id, escalate.id)
    } catch (err) {
        clickError = (err as Error).message
    }

    // Give the handler a moment to make its openDialog call.
    await ctx.waitFor(async () => (lastDialog(ctx) ? true : null), {timeoutMs: 8000, intervalMs: 500})

    const handlerCall = journalSince(ctx, 'mm_to_handler', '/actions/escalate').at(-1)
    if (!handlerCall) {
        return fail(
            id,
            title,
            `Clicking the button did not reach your handler.${clickError ? ` Mattermost said: ${clickError}` : ''}`,
            `Point the button's integration.url at ${config.publicBaseUrl}/actions/escalate`,
        )
    }

    const dialog = lastDialog(ctx)
    if (!dialog) {
        const openCall = journalSince(ctx, 'handler_to_mm', '/api/v4/actions/dialogs/open').at(-1)
        return fail(
            id,
            title,
            openCall
                ? `A dialog open call was made but carried no dialog body (Mattermost answered ${openCall.response?.status}).`
                : 'Your handler was called but never opened a dialog.',
            'Call openDialog() with payload.trigger_id. That id expires within seconds, so fetch anything you need first and open the dialog last. ' +
                'If you replaced lib/mattermost.ts with a direct call to Mattermost, this check cannot see the dialog definition.',
            handlerCall.seq,
        )
    }

    const problems: string[] = []
    for (const required of REQUIRED_ELEMENTS) {
        const element = (dialog.elements ?? []).find(
            (e) => required.match.test(e.name ?? '') || required.match.test(e.display_name ?? ''),
        )
        if (!element) {
            problems.push(`no element for ${required.label}`)
            continue
        }
        if (element.type !== required.type) {
            problems.push(`${required.label} is a ${element.type}, expected ${required.type}`)
        }
        if (required.type === 'select') {
            const values = (element.options ?? []).map((o) => String(o.value).toUpperCase())
            const wanted = ['CRITICAL', 'HIGH', 'MEDIUM']
            const missing = wanted.filter((w) => !values.includes(w))
            if (missing.length) {
                problems.push(`${required.label} is missing option(s) ${missing.join(', ')}`)
            }
        }
    }

    if (problems.length) {
        return fail(
            id,
            title,
            `Dialog opened but: ${problems.join('; ')}.`,
            'The dialog needs Severity (select, CRITICAL / HIGH / MEDIUM), Affected Systems (text), Assignee (text), and Notes (textarea).',
            handlerCall.seq,
        )
    }

    return pass(id, title, `Dialog "${dialog.title}" opened with all four elements correctly typed.`)
}

/** Posts a submission at the handler the way Mattermost would. */
async function submit(submission: Record<string, unknown>, state: string): Promise<{status: number; body: unknown}> {
    const res = await fetch(`http://127.0.0.1:${config.port}/dialogs/escalate/submit`, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
            type: 'dialog_submission',
            callback_id: 'escalate',
            state,
            user_id: 'graderuserid00000000000000',
            channel_id: config.channels.alerts,
            team_id: config.team.id,
            submission,
            cancelled: false,
        }),
        signal: AbortSignal.timeout(25_000),
    })
    const text = await res.text()
    return {status: res.status, body: text ? JSON.parse(text) : null}
}

async function validationRejects(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod5-validation'
    const title = 'Blank required fields come back as field level errors'

    const dialog = lastDialog(ctx)
    const names = {
        severity: elementName(dialog, /sever/i, FALLBACK_NAMES.severity),
        affected: elementName(dialog, /affect|system/i, FALLBACK_NAMES.affected),
        assignee: elementName(dialog, /assign/i, FALLBACK_NAMES.assignee),
        notes: elementName(dialog, /note/i, FALLBACK_NAMES.notes),
    }

    const cases: Array<{label: string; submission: Record<string, unknown>; expect: string}> = [
        {
            label: 'Severity blank',
            expect: names.severity,
            submission: {[names.severity]: '', [names.affected]: 'DC-02', [names.assignee]: 'analyst', [names.notes]: 'x'},
        },
        {
            label: 'Affected Systems blank',
            expect: names.affected,
            submission: {[names.severity]: 'CRITICAL', [names.affected]: '', [names.assignee]: 'analyst', [names.notes]: 'x'},
        },
    ]

    const before = (await ctx.mm.getChannelPosts(config.channels.incidents, {since: Date.now() - 2000})).length

    for (const testCase of cases) {
        const {status, body} = await submit(testCase.submission, 'graderstate')
        const response = (body ?? {}) as {errors?: Record<string, string>; error?: string}

        if (status >= 400) {
            return fail(
                id,
                title,
                `${testCase.label}: your handler returned HTTP ${status}.`,
                'Return 200 with an errors object. A non-2xx shows the analyst a generic failure and loses everything they typed.',
            )
        }

        if (!response.errors || Object.keys(response.errors).length === 0) {
            return fail(
                id,
                title,
                `${testCase.label}: response was ${JSON.stringify(body)}.`,
                `Return {errors: {${testCase.expect}: 'message'}} so the dialog stays open and the message appears under that field. ` +
                    'A top level `error` shows a form level message instead, which does not tell the analyst which field to fix.',
            )
        }

        const keys = Object.keys(response.errors)
        if (!keys.includes(testCase.expect)) {
            return fail(
                id,
                title,
                `${testCase.label}: errors were keyed ${keys.join(', ')}.`,
                `Key the error by the element's \`name\`, which is "${testCase.expect}", not by its display_name.`,
            )
        }
    }

    await new Promise((r) => setTimeout(r, 2000))
    const after = (await ctx.mm.getChannelPosts(config.channels.incidents, {since: Date.now() - 10_000})).length
    if (after > before) {
        return fail(
            id,
            title,
            'An invalid submission still produced a post in #incidents.',
            'Return the errors and stop. Do not post until validation passes.',
        )
    }

    return pass(id, title, 'Both blank field cases returned field level errors and posted nothing.')
}

async function validSubmissionPosts(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod5-escalation-posted'
    const title = 'A valid submission posts a structured escalation'

    const {post: origin} = await fireAndFindAlert(ctx)
    if (!origin) {
        return fail(id, title, 'The stimulus alert never appeared in #alerts.', 'Environment fault rather than a learner error.')
    }

    // Click first so the handler stores the originating post id in the dialog state,
    // which is what it will read back on submission.
    const escalate = findEscalateAction(origin)
    if (escalate?.id) {
        try {
            await ctx.mm.doPostAction(origin.id, escalate.id)
        } catch {
            // Covered by the dialog check. A failure here only costs us the state value.
        }
        await ctx.waitFor(async () => (lastDialog(ctx) ? true : null), {timeoutMs: 8000, intervalMs: 500})
    }

    const dialog = lastDialog(ctx)
    const names = {
        severity: elementName(dialog, /sever/i, FALLBACK_NAMES.severity),
        affected: elementName(dialog, /affect|system/i, FALLBACK_NAMES.affected),
        assignee: elementName(dialog, /assign/i, FALLBACK_NAMES.assignee),
        notes: elementName(dialog, /note/i, FALLBACK_NAMES.notes),
    }

    const values = {
        severity: 'CRITICAL',
        affected: 'DC-02, FIN-WKS-114',
        assignee: 'grader.analyst',
        notes: 'Escalated by the automated check.',
    }

    const since = Date.now() - 1000
    const {status, body} = await submit(
        {
            [names.severity]: values.severity,
            [names.affected]: values.affected,
            [names.assignee]: values.assignee,
            [names.notes]: values.notes,
        },
        dialog?.state ?? origin.id,
    )

    const response = (body ?? {}) as {errors?: Record<string, string>; error?: string}
    if (response.error || (response.errors && Object.keys(response.errors).length > 0)) {
        return fail(
            id,
            title,
            `A complete submission was rejected: ${JSON.stringify(body)}`,
            'Every required field was supplied. Check the validation is not rejecting valid input, for example by testing the display_name key instead of the element name.',
        )
    }
    if (status >= 400) {
        return fail(id, title, `Your handler returned HTTP ${status}.`, 'Return 200 with an empty object to accept and close the dialog.')
    }

    const escalation = await ctx.waitFor<Post>(
        async () => {
            const posts = await ctx.mm.getChannelPosts(config.channels.incidents, {since})
            return posts.find((p) => p.create_at >= since && p.delete_at === 0 && attachmentText(p).includes(values.affected)) ?? null
        },
        {timeoutMs: 20_000},
    )

    if (!escalation) {
        return fail(
            id,
            title,
            'The submission was accepted but nothing appeared in #incidents.',
            'Post the escalation with createPost() targeting config.channels.incidents.',
        )
    }

    const text = attachmentText(escalation)
    const missing: string[] = []
    if (!text.includes(values.severity)) missing.push('severity')
    if (!text.includes(values.affected)) missing.push('affected systems')
    if (!text.includes(values.assignee)) missing.push('assignee')
    if (!text.includes(values.notes)) missing.push('notes')
    if (!/graderuserid|grader/i.test(text)) missing.push("the submitting analyst's identity")
    if (!/\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}/.test(text)) missing.push('a timestamp')
    if (!text.includes(origin.id)) missing.push('a permalink to the original alert')

    if (looksLikeLeakedError(text)) {
        return fail(id, title, `The escalation contains a raw error: ${text.slice(0, 160)}`, 'Handle the failure rather than posting the exception.')
    }

    if (missing.length) {
        return fail(
            id,
            title,
            `Escalation posted but is missing: ${missing.join(', ')}.`,
            'Include every form field, the analyst who submitted it, a timestamp, and permalink(originalPostId). ' +
                'The original post id round trips through the dialog `state` you set when opening it.',
        )
    }

    return pass(id, title, `Escalation posted to #incidents with all fields and a link back to ${origin.id}.`)
}

registerChallenge({
    module: 5,
    challenge: 1,
    title: 'Escalate button opens a dialog and posts a structured escalation',
    checks: [
        {id: 'mod5-button-present', title: 'Alerts carry an Escalate button', run: buttonPresent},
        {id: 'mod5-dialog-opens', title: 'Clicking Escalate opens a correctly defined dialog', run: dialogOpens},
        {id: 'mod5-validation', title: 'Blank required fields come back as field level errors', run: validationRejects},
        {id: 'mod5-escalation-posted', title: 'A valid submission posts a structured escalation', run: validSubmissionPosts},
    ],
})
