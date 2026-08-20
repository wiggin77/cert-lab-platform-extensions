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
 * message is logged and echoed back where the calling surface can display it.
 */
app.setErrorHandler((err: unknown, req, reply) => {
    const message = err instanceof Error ? err.message : String(err)
    req.log.error({err}, `unhandled error in ${req.url}`)
    return reply.code(200).send({
        response_type: 'ephemeral',
        ephemeral_text: `Handler error in ${req.url}: ${message}`,
        text: `Handler error in ${req.url}: ${message}`,
    })
})

app.listen({host: '0.0.0.0', port: config.port})
    .then(() => warnMissing(app.log))
    .catch((err) => {
        app.log.error(err)
        process.exit(1)
    })
