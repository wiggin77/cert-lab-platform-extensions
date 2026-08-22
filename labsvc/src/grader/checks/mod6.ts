/**
 * Module 6, plugin development.
 *
 * Plugin HTTP endpoints live at /plugins/{plugin_id}/... on the root router, not under
 * /api/v4. Source: channels/app/channels.go:239
 *
 * Challenge 2 is webapp work, and a server side grader cannot see React render. What it
 * can verify is that the bundle built, that it registers the three extension points, and
 * that the server endpoints the components depend on actually work. The checks say so
 * explicitly rather than implying they proved more than they did. Replacing the bundle
 * inspection with a Playwright driven check is the obvious upgrade if the hot start image
 * ever carries a browser.
 */

import {config} from '../../config.js'
import type {Post} from '../../mm/client.js'
import {fail, pass, registerChallenge, type CheckContext, type CheckResult} from '../index.js'
import {journalSince, waitForAlertPost} from './shared.js'

type AlertRecord = {
    severity?: string
    source?: string
    indicator?: string
    timestamp?: string
    status?: string
}

const REGISTRATIONS = [
    {symbol: 'registerPostTypeComponent', what: 'the custom post card'},
    {symbol: 'registerRightHandSidebarComponent', what: 'the right hand sidebar pane'},
    {symbol: 'registerChannelHeaderButtonAction', what: 'the channel header widget'},
]

async function pluginActive(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod6-plugin-active'
    const title = 'The alerts plugin is installed and running'

    const plugins = await ctx.mm.getPlugins()
    const active = plugins.active.find((p) => p.id === config.pluginId)

    if (active) {
        return pass(id, title, `${config.pluginId} v${active.version} is active.`)
    }

    const inactive = plugins.inactive.find((p) => p.id === config.pluginId)
    if (inactive) {
        return fail(
            id,
            title,
            `${config.pluginId} is installed but not enabled.`,
            'Enable it in System Console > Plugins, or run: make deploy from the plugin directory.',
        )
    }

    return fail(
        id,
        title,
        `${config.pluginId} is not installed. Active plugins: ${plugins.active.map((p) => p.id).join(', ') || '(none)'}.`,
        'Build and deploy the plugin from /home/learner/plugin. A Go build failure is the usual cause, so check the build output first.',
    )
}

/** Fires an alert and returns the post the plugin should have reacted to. */
async function stimulusAlert(ctx: CheckContext): Promise<Post | null> {
    const since = Date.now() - 1000
    const fired = await ctx.feed.fire({severity: 'CRITICAL', runId: ctx.runId})
    return waitForAlertPost(ctx, fired.alert, since)
}

async function kvRecordWritten(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod6-kv-record'
    const title = 'A new alert is captured into the KV Store'

    const post = await stimulusAlert(ctx)
    if (!post) {
        return fail(id, title, 'The stimulus alert never appeared in #alerts.', 'Environment fault rather than a learner error.')
    }

    const found = await ctx.waitFor<AlertRecord>(
        async () => {
            const res = await ctx.mm.pluginRequest<AlertRecord>(config.pluginId, `/api/v1/alert/${post.id}`)
            return res.status === 200 ? (res.body as AlertRecord) : null
        },
        {timeoutMs: 20_000},
    )

    if (!found) {
        const probe = await ctx.mm.pluginRequest(config.pluginId, `/api/v1/alert/${post.id}`)
        return fail(
            id,
            title,
            `GET /plugins/${config.pluginId}/api/v1/alert/${post.id} returned ${probe.status}.`,
            probe.status === 404
                ? 'Either the MessageHasBeenPosted hook did not fire, or it did not write a KV record keyed to the post id. Confirm the hook filters on the #alerts channel id and not on the channel name.'
                : 'Register the endpoint on your plugin sub-router and return the KV record as JSON.',
        )
    }

    const missing = (['severity', 'source', 'indicator', 'timestamp'] as const).filter((f) => !found[f])
    if (missing.length) {
        return fail(
            id,
            title,
            `Record found but missing field(s): ${missing.join(', ')}. Got: ${JSON.stringify(found)}`,
            'Parse all four fields out of the post props. The values live in props.attachments[0].fields, not in the message text.',
        )
    }

    if (String(found.status).toLowerCase() !== 'open') {
        return fail(
            id,
            title,
            `Record status is "${found.status}".`,
            'A newly captured alert starts with status "open".',
        )
    }

    return pass(id, title, `Alert ${post.id} captured with all four fields at status "open".`)
}

async function statusUpdates(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod6-status-update'
    const title = 'Alert status can be updated and read back'

    const post = await stimulusAlert(ctx)
    if (!post) {
        return fail(id, title, 'The stimulus alert never appeared in #alerts.', 'Environment fault rather than a learner error.')
    }

    const captured = await ctx.waitFor(
        async () => {
            const res = await ctx.mm.pluginRequest(config.pluginId, `/api/v1/alert/${post.id}`)
            return res.status === 200 ? res : null
        },
        {timeoutMs: 20_000},
    )
    if (!captured) {
        return fail(id, title, 'The alert was never captured, so there is nothing to update.', 'Fix the previous check first.')
    }

    const update = await ctx.mm.pluginRequest(config.pluginId, `/api/v1/alert/${post.id}/status`, {
        method: 'POST',
        body: {status: 'acknowledged'},
    })

    if (update.status >= 400) {
        return fail(
            id,
            title,
            `POST /api/v1/alert/${post.id}/status returned ${update.status}: ${JSON.stringify(update.body).slice(0, 160)}`,
            'Accept a JSON body carrying the new status, write it back to the KV Store, and return 200.',
        )
    }

    const after = await ctx.mm.pluginRequest<AlertRecord>(config.pluginId, `/api/v1/alert/${post.id}`)
    const status = String((after.body as AlertRecord)?.status ?? '').toLowerCase()

    if (status !== 'acknowledged') {
        return fail(
            id,
            title,
            `The update returned ${update.status} but a re-read still shows status "${status}".`,
            'The write is not persisting. Read the existing record, change the status field, and write the whole record back under the same key.',
        )
    }

    return pass(id, title, `Status moved from "open" to "acknowledged" and persisted.`)
}

async function openCountExposed(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod6-open-count'
    const title = 'An open alert count is exposed for the header widget'

    const res = await ctx.mm.pluginRequest<{open?: number}>(config.pluginId, '/api/v1/alerts/count')

    if (res.status === 404) {
        return fail(
            id,
            title,
            `GET /plugins/${config.pluginId}/api/v1/alerts/count returned 404.`,
            'The channel header widget needs a count to display. Expose an endpoint returning {"open": <number>} so the webapp has something to fetch.',
        )
    }
    if (res.status >= 400) {
        return fail(id, title, `The count endpoint returned ${res.status}.`, 'Return 200 with {"open": <number>}.')
    }

    const before = (res.body as {open?: number})?.open
    if (typeof before !== 'number') {
        return fail(
            id,
            title,
            `Response was ${JSON.stringify(res.body)}.`,
            'Return a JSON object with a numeric "open" property.',
        )
    }

    // Capture a fresh alert, then acknowledge it, and confirm the count tracks both moves.
    const post = await stimulusAlert(ctx)
    if (!post) {
        return fail(id, title, 'The stimulus alert never appeared.', 'Environment fault rather than a learner error.')
    }

    const raised = await ctx.waitFor(
        async () => {
            const now = await ctx.mm.pluginRequest<{open?: number}>(config.pluginId, '/api/v1/alerts/count')
            const value = (now.body as {open?: number})?.open
            return typeof value === 'number' && value > before ? value : null
        },
        {timeoutMs: 20_000},
    )

    if (raised === null) {
        return fail(
            id,
            title,
            `The count stayed at ${before} after a new alert was captured.`,
            'Count the KV records whose status is "open", rather than returning a value cached at activation.',
        )
    }

    await ctx.mm.pluginRequest(config.pluginId, `/api/v1/alert/${post.id}/status`, {
        method: 'POST',
        body: {status: 'acknowledged'},
    })

    const lowered = await ctx.waitFor(
        async () => {
            const now = await ctx.mm.pluginRequest<{open?: number}>(config.pluginId, '/api/v1/alerts/count')
            const value = (now.body as {open?: number})?.open
            return typeof value === 'number' && value < raised ? value : null
        },
        {timeoutMs: 15_000},
    )

    if (lowered === null) {
        return fail(
            id,
            title,
            `The count rose to ${raised} on capture but did not fall after the alert was acknowledged.`,
            'Only records at status "open" should be counted.',
        )
    }

    return pass(id, title, `Count tracked ${before} -> ${raised} on capture, and back to ${lowered} on acknowledgement.`)
}

// ---------------------------------------------------------------------------
// Challenge 2, webapp
// ---------------------------------------------------------------------------

async function resolveBundle(ctx: CheckContext): Promise<{path: string; text: string} | null> {
    const manifests = await ctx.mm.getWebappPlugins()
    const manifest = manifests.find((m) => m.id === config.pluginId)
    const declared = manifest?.webapp?.bundle_path
    if (!declared) {
        return null
    }

    // The manifest declares /static/<id>/<bundle>, while the static handler is mounted at
    // /static/plugins/. Try both rather than depending on which one this server version
    // serves.
    const candidates = [declared, declared.replace('/static/', '/static/plugins/')]
    for (const path of candidates) {
        const res = await ctx.mm.fetchRaw(path)
        if (res.status === 200 && res.text.length > 0) {
            return {path, text: res.text}
        }
    }
    return null
}

async function bundleRegisters(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod6-webapp-bundle'
    const title = 'The webapp bundle builds and registers all three components'

    const bundle = await resolveBundle(ctx)
    if (!bundle) {
        return fail(
            id,
            title,
            'No webapp bundle is being served for the plugin.',
            'The webpack build did not produce a bundle, or plugin.json does not declare webapp.bundle_path. Check the build output.',
        )
    }

    // Symbols are tested before size on purpose. The starter bundle is under a kilobyte,
    // so a size test first would tell a learner who has simply not written the
    // registrations yet that their build is broken, which it is not.
    //
    // The symbols survive minification because they are property accesses, and terser
    // does not mangle property names by default. Comments and TypeScript types naming
    // them do NOT survive, so a bundle that mentions them only in a TODO does not pass.
    const missing = REGISTRATIONS.filter((r) => !bundle.text.includes(r.symbol))
    if (missing.length) {
        return fail(
            id,
            title,
            `Bundle served (${bundle.text.length} bytes) but ${missing.map((m) => m.symbol).join(', ')} not found in it.`,
            `Register ${missing.map((m) => m.what).join(', ')} in your plugin's initialize(registry, store). ` +
                'If you have written the calls already, rebuild with `make deploy`: the served bundle is the built one, not your source.',
        )
    }

    if (bundle.text.length < 1000) {
        return fail(
            id,
            title,
            `All three registrations are present, but the bundle at ${bundle.path} is only ${bundle.text.length} bytes.`,
            'That is too small to contain the components as well as the registry calls. The build probably failed part way through.',
        )
    }

    return pass(
        id,
        title,
        `Bundle served from ${bundle.path} (${Math.round(bundle.text.length / 1024)} KB), calling all three registry methods. ` +
            'Note this verifies registration and build, not that the components render.',
    )
}

async function aiSkillWorks(ctx: CheckContext): Promise<CheckResult> {
    const id = 'mod6-ai-skill'
    const title = 'An AI skill analyses an alert and replies in its thread'

    const post = await stimulusAlert(ctx)
    if (!post) {
        return fail(id, title, 'The stimulus alert never appeared in #alerts.', 'Environment fault rather than a learner error.')
    }

    await ctx.waitFor(
        async () => {
            const res = await ctx.mm.pluginRequest(config.pluginId, `/api/v1/alert/${post.id}`)
            return res.status === 200 ? true : null
        },
        {timeoutMs: 20_000},
    )

    const invoked = await ctx.mm.pluginRequest(config.pluginId, `/api/v1/alert/${post.id}/analyze`, {
        method: 'POST',
        body: {skill: 'analyze_threat_surface'},
    })

    if (invoked.status >= 400) {
        return fail(
            id,
            title,
            `POST /api/v1/alert/${post.id}/analyze returned ${invoked.status}: ${JSON.stringify(invoked.body).slice(0, 200)}`,
            'This is the endpoint the RHS pane buttons call. It should build a prompt from the alert, pass it to the Agents plugin helper, and post the answer.',
        )
    }

    const llmCall = await ctx.waitFor(
        async () => journalSince(ctx, 'llm_call').at(-1) ?? null,
        {timeoutMs: 25_000},
    )

    if (!llmCall) {
        return fail(
            id,
            title,
            'The endpoint answered but no request reached the LLM.',
            'Confirm the Agents plugin is configured against the lab LLM at ' +
                `${config.publicBaseUrl}/mock/llm/v1, with a non-empty API key. The Agents plugin rejects a blank key even for local services.`,
        )
    }

    const prompt = String((llmCall.request.body as {prompt?: string})?.prompt ?? '')
    const record = await ctx.mm.pluginRequest<AlertRecord>(config.pluginId, `/api/v1/alert/${post.id}`)
    const indicator = (record.body as AlertRecord)?.indicator ?? ''

    if (indicator && !prompt.includes(indicator)) {
        return fail(
            id,
            title,
            `The prompt did not mention the alert's indicator (${indicator}). Prompt began: ${prompt.slice(0, 120)}`,
            'Pass the alert data as context. A skill that analyses nothing in particular returns generic text.',
            llmCall.seq,
        )
    }

    const reply = await ctx.waitFor<Post>(
        async () => {
            const thread = await ctx.mm.getPostThread(post.id)
            return thread.find((p) => p.id !== post.id && /threat surface assessment/i.test(p.message)) ?? null
        },
        {timeoutMs: 25_000},
    )

    if (!reply) {
        const thread = await ctx.mm.getPostThread(post.id)
        return fail(
            id,
            title,
            `The LLM answered but no reply carrying the analysis appeared in the alert's thread (${thread.length - 1} repl(ies) present).`,
            'Post the response with root_id set to the alert post id, so it threads under the alert rather than landing at channel root.',
            llmCall.seq,
        )
    }

    return pass(id, title, `Skill ran with the alert as context and replied in thread on ${post.id}.`)
}

registerChallenge({
    module: 6,
    challenge: 1,
    title: 'Plugin server side: hook, KV Store, HTTP endpoints',
    checks: [
        {id: 'mod6-plugin-active', title: 'The alerts plugin is installed and running', run: pluginActive},
        {id: 'mod6-kv-record', title: 'A new alert is captured into the KV Store', run: kvRecordWritten},
        {id: 'mod6-status-update', title: 'Alert status can be updated and read back', run: statusUpdates},
        {id: 'mod6-open-count', title: 'An open alert count is exposed for the header widget', run: openCountExposed},
    ],
})

registerChallenge({
    module: 6,
    challenge: 2,
    title: 'Plugin webapp side: post card, RHS pane, header widget',
    checks: [
        {id: 'mod6-webapp-bundle', title: 'The webapp bundle builds and registers all three components', run: bundleRegisters},
        {id: 'mod6-ai-skill', title: 'An AI skill analyses an alert and replies in its thread', run: aiSkillWorks},
    ],
})
