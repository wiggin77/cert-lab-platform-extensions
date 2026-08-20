# labsvc

Lab infrastructure for the **Mattermost Platform Extension Expert** certification track.

Design: [../DESIGN.md](../DESIGN.md)

labsvc runs beside the learner's handler and plays four roles at once:

- **Bidirectional recording proxy** between Mattermost and the learner's handler
- **Mock services**: threat feed, threat intel API, and an OpenAI compatible LLM
- **Grader**: stimulus driven, idempotent, re-runnable checks per challenge
- **Inspector**: a live view of every request in both directions

It is deliberately a separate process from the learner's handler, so a learner writing a
syntax error cannot take down grading.

## Quick start

```bash
npm install
cp .env.example .env      # fill in ids and tokens after seeding Mattermost
npm run dev               # tsx watch, no build step
```

Then open <http://localhost:4000/inspector>.

Without `MM_ADMIN_TOKEN` the mocks, proxies, and inspector all work. Grading and reset
return 503 until it is set.

## Layout

```
src/
  server.ts              entry point, route wiring
  config.ts              all environment configuration
  types.ts               Mattermost payload types, transcribed from server/public/model
  proxy/
    inbound.ts           Mattermost -> handler, response_url rewriting, failure synthesis
    outbound.ts          handler -> Mattermost, transparent
    journal.ts           hash chained JSONL + in memory ring + SSE
    redact.ts            secret masking, applied on the way out to the browser only
  mocks/
    feed.ts              threat feed, dual transport, seeded, pausable
    intel.ts             Module 4 lookup API
    llm.ts               Module 6 OpenAI compatible mock
  grader/
    index.ts             framework: registry, runner, check context
    checks/              per module assertions
  admin/index.ts         snapshot and reset
  inspector/index.html   live traffic UI
fixtures/                alerts, indicators, canned LLM responses
scripts/                 fire-alert.sh, check-challenge.sh
```

## Endpoints

| Group | Endpoint |
| --- | --- |
| Health | `GET /healthz`, `GET /api/urls` |
| Inbound proxy | `POST /hooks/outgoing`, `/commands/threat`, `/actions/escalate`, `/dialogs/escalate/submit` |
| Delayed responses | `POST /hooks/commands/:id` |
| Outbound proxy | `ALL /mm/api/v4/*` |
| Feed | `GET /mock/feed`, `POST /mock/feed/{fire,pause,resume,start,stop}` |
| Intel | `GET /mock/intel/v1/indicators/:indicator`, `GET /mock/intel/v1/_catalog` |
| LLM | `POST /mock/llm/v1/chat/completions`, `GET /mock/llm/v1/models` |
| Journal | `GET /api/journal`, `GET /api/journal/stream` |
| Grader | `GET /grader/challenges`, `POST /grader/run/:module/:challenge`, `GET /grader/last/:module/:challenge` |
| Admin | `POST /admin/snapshot`, `POST /admin/reset`, `GET /admin/snapshot` |

## Things that are easy to get wrong

**Internal URLs, not public ones.** The URLs a learner pastes into Mattermost are fetched
by the Mattermost *server* process. `LABSVC_PUBLIC_BASE_URL` must be the internal address
(`http://workbench:4000`), never the browser facing `env.play.instruqt.com` form. The
grader detects both that mistake and `localhost` and emits a specific hint.

**Feed transport.** Posts created by an incoming webhook do not fire outgoing webhook
triggers. The feed uses an incoming webhook for Module 2, where configuring one is the
lesson, and posts over REST as a bot from Module 3 onward. `LAB_MODULE` drives the switch.

**Raw bodies.** `server.ts` calls `removeAllContentTypeParsers()` before installing a
catch-all buffer parser. Fastify's built-in JSON parser otherwise takes precedence and the
proxies end up holding a parsed object where they need original bytes. Routes that want
structured input use `jsonBody()` from `util/body.ts`.

**Agents plugin API key.** The Agents plugin rejects a blank API key even for local,
OpenAI compatible services. The track setup script must set a dummy non-empty value when
pointing it at `/mock/llm/v1`.

## Writing a check

Checks live in `src/grader/checks/`. Each one supplies its own stimulus so it never
depends on the learner having fired something manually at the right moment.

```ts
async function escalationPosted(ctx: CheckContext): Promise<CheckResult> {
    const since = Date.now() - 1000
    const fired = await ctx.feed.fire({severity: 'CRITICAL', transport: 'bot_rest', runId: ctx.runId})
    const post = await ctx.waitFor(async () => findIt(await ctx.mm.getChannelPosts(chan, {since})))

    return post
        ? pass('id', 'title', 'what was observed')
        : fail('id', 'title', 'what was observed', 'the next concrete action to take')
}
```

Rules that keep checks trustworthy:

- Assert on **Mattermost state**, not on the journal. Use the journal only to sharpen a
  hint. A learner who bypasses the proxy must still pass.
- Never read learner source code.
- `detail` says what was observed. `hint` names the next action, it does not restate the
  rule.
- The runner already holds the feed pause lock and takes a snapshot around every run.

## Status

Built: journal, both proxies, all three mocks, grader framework, admin reset, inspector,
Module 2 and Module 3 checks.

Not built: Module 4, 5, and 6 checks (registered as `pending`, so `/grader/challenges`
lists the full track), the learner handler scaffold, and the Instruqt track configuration.
