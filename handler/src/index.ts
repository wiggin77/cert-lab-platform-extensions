/**
 * Your integration handler.
 *
 * The routing below is already wired up and matches the URLs configured in Mattermost.
 * Your work happens in src/routes/ and src/payloads/, one file per module.
 *
 * This file restarts automatically when you save. Watch it with:
 *     sudo journalctl -u mm-handler -f
 */

import Fastify from 'fastify'

import {config, warnMissing} from './config.js'
import {handleDialogSubmit} from './routes/dialog-submit.js'
import {handleOutgoingWebhook} from './routes/outgoing-webhook.js'
import {handlePostAction} from './routes/post-action.js'
import {handleThreatCommand} from './routes/threat-command.js'

const app = Fastify({logger: {level: process.env.LOG_LEVEL ?? 'info', transport: {target: 'pino-pretty'}}})

// Slash commands and outgoing webhooks arrive form encoded. Fastify only parses JSON out
// of the box, so this makes req.body a plain object for both content types.
app.addContentTypeParser('application/x-www-form-urlencoded', {parseAs: 'string'}, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)))
})

app.get('/healthz', async () => ({ok: true}))

// Module 3
app.post('/webhooks/outgoing', handleOutgoingWebhook)

// Module 4
app.post('/commands/threat', handleThreatCommand)

// Module 5
app.post('/actions/escalate', handlePostAction)
app.post('/dialogs/escalate/submit', handleDialogSubmit)

/**
 * An uncaught error in your code lands here.
 *
 * Mattermost shows a generic failure for a 500, which tells you nothing, so the real
 * message is logged and echoed back where the calling surface can display it. Every
 * surface reads a different field, so all of them are set:
 *
 *   text            slash commands and outgoing webhooks
 *   ephemeral_text  post actions
 *   error           dialog submissions
 *
 * `error` matters more than it looks. Without it a dialog whose handler threw just closes,
 * exactly as though it had succeeded, and nothing is posted.
 */
app.setErrorHandler((err: unknown, req, reply) => {
    // Node reports most network failures as the bare string "fetch failed" and hides the
    // real reason on err.cause, which is useless on its own.
    const cause = (err as {cause?: {code?: string}})?.cause?.code
    const base = err instanceof Error ? err.message : String(err)
    const message = `Handler error in ${req.url}: ${base}${cause ? ` (${cause})` : ''}`

    req.log.error({err}, `unhandled error in ${req.url}`)

    return reply.code(200).send({
        response_type: 'ephemeral',
        text: message,
        ephemeral_text: message,
        error: message,
    })
})

app.listen({host: '0.0.0.0', port: config.port})
    .then(() => warnMissing(app.log))
    .catch((err) => {
        app.log.error(err)
        process.exit(1)
    })
