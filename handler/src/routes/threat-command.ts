/**
 * MODULE 3  ·  Slash Commands
 *
 * An analyst runs `/threat <indicator>` in #alerts. You look the indicator up against the
 * mock threat intel API and return enrichment data.
 *
 * THE TIMEOUT IS THE LESSON
 *   Mattermost gives a slash command a few seconds to reply, then gives up and shows the
 *   user an error. A threat intel lookup can outlast that. The pattern is:
 *
 *     1. return an ephemeral acknowledgment immediately
 *     2. do the slow work
 *     3. deliver the result separately, via response_url or the REST API
 *
 *   The Lab Inspector shows how long your handler took on every call, so you can see this
 *   happening rather than guess.
 *
 * WHAT THE CHECK LOOKS FOR
 *   1. An acknowledgment returned inside the budget
 *   2. The intel API queried with the indicator the user passed
 *   3. An enrichment attachment with malware family, confidence, last seen, and campaigns
 *   4. A clean message for an indicator the API does not hold, not a crash
 *
 * NOT EVERY INDICATOR IS KNOWN
 *   The API returns 404 with a JSON error body for indicators it has no data on. Try
 *   198.51.100.23. Some known indicators also come back with an empty campaigns array,
 *   for example telemetry-sync.example.
 *
 * USEFUL HELPERS
 *   isValidToken()                from ../lib/verify.js
 *   createPost(), createReply()   from ../lib/mattermost.js
 *   attachment(), field(), code() from ../lib/attachments.js
 *   config.intelApiUrl            from ../config.js
 *
 * TRY IT
 *   /threat 203.0.113.47      known
 *   /threat 198.51.100.23     not held
 *   Browse everything: curl $LABSVC_URL/mock/intel/v1/_catalog
 */

import type {FastifyReply, FastifyRequest} from 'fastify'

import type {CommandResponse, SlashCommandRequest} from '../lib/types.js'

export async function handleThreatCommand(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const payload = req.body as SlashCommandRequest

    req.log.info({user: payload.user_name, text: payload.text}, 'slash command received')

    // TODO Module 3, step 1: reject the request unless the token matches
    // config.commandToken.

    // TODO Module 3, step 2: read the indicator out of payload.text and handle the case
    // where the user typed `/threat` with nothing after it.

    // TODO Module 3, step 3: kick off the lookup WITHOUT awaiting it here, so you can
    // return the acknowledgment below straight away.
    //
    //   void enrich(indicator, payload).catch((err) => req.log.error({err}, 'enrichment failed'))
    //
    // Write enrich() at the bottom of this file. It should query
    // `${config.intelApiUrl}/indicators/${encodeURIComponent(indicator)}`, build an
    // attachment from the result, and deliver it.

    // TODO Module 3, step 4: return an ephemeral acknowledgment naming the indicator, so
    // the analyst knows the lookup is running.
    const response: CommandResponse = {
        response_type: 'ephemeral',
        text: 'The /threat command is not implemented yet.',
    }
    return reply.send(response)
}

/**
 * TODO Module 3: implement the lookup and delivery.
 *
 * Two ways to deliver the result, both acceptable:
 *
 *   a) POST your CommandResponse to payload.response_url. No bot token needed, and it is
 *      the mechanism Mattermost provides for exactly this. The URL is short lived.
 *
 *   b) createReply(payload.root_id || <the user's post>, payload.channel_id, ...) using
 *      the bot token, which gives you full control over threading.
 *
 * The Lab Inspector records both, so you can see whichever you pick actually land.
 */
// async function enrich(indicator: string, payload: SlashCommandRequest): Promise<void> {
// }
