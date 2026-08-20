# Integration handler

This is the codebase you extend across modules 2 to 5 of the **Mattermost Platform
Extension Expert** certification.

Each module adds one capability the previous one could not provide. You are not starting
over each time, you are growing one integration.

## Where your work goes

| Module | File | What you build |
| --- | --- | --- |
| 2 | `src/payloads/alert-payload.ts` | Format alerts as message attachments |
| 3 | `src/routes/outgoing-webhook.ts` | Auto-escalate CRITICAL alerts to #incidents |
| 4 | `src/routes/threat-command.ts` | `/threat <indicator>` enrichment lookup |
| 5 | `src/routes/post-action.ts` | Escalate button opens a dialog |
| 5 | `src/routes/dialog-submit.ts` | Validate and post the structured escalation |

Everything else is pre-wired and you should not need to change it.

## What is already done for you

```
src/
  index.ts               routing, form-encoded body parsing, error reporting
  config.ts              environment, already populated by the lab
  lib/
    types.ts             every Mattermost payload, typed and documented
    mattermost.ts        REST client: createPost, createReply, getPost, openDialog, permalink
    attachments.ts       attachment(), field(), code(), button(), severityColor()
    alert.ts             parseAlertFromProps(), extractIndicator()
    verify.ts            isValidToken(), constant time token comparison
```

`src/lib/types.ts` is worth reading before you start. The types are transcribed from the
Mattermost source rather than from documentation, so the field names are exactly what
arrives on the wire, and the comments flag the parts that surprise people.

## Running it

The handler runs as a service and reloads when you save. You do not need to start it.

```bash
sudo systemctl status mm-handler      # is it up
sudo journalctl -u mm-handler -f      # live logs, including your req.log calls
sudo systemctl restart mm-handler     # if it gets wedged
```

## Debugging

Open the **Lab Inspector** tab. It shows every request in both directions, live:

- what Mattermost sent you, and what you returned
- what you sent Mattermost, and what it answered
- how long your handler took, flagged when it runs over the slash command budget
- notes on common mistakes, such as a missing Authorization header

If an integration seems dead, look there first. It answers the "did Mattermost even call
me" question immediately, which is usually the actual question.

Firing an alert on demand:

```bash
fire-alert.sh                            # random alert
fire-alert.sh --severity CRITICAL        # a CRITICAL one
fire-alert.sh --indicator 203.0.113.47   # a specific indicator
```

## Four things that catch people out

**There is no signature header.** Mattermost authenticates outgoing webhooks and slash
commands with a plaintext shared token in the request body. There is nothing to recompute
and no HMAC to verify. Comparing that token correctly, in constant time, is the whole
security model. See `src/lib/verify.ts`.

**Threads cannot span channels.** A reply always lands in its root's channel. You cannot
thread a post in #incidents under an alert in #alerts. Use `permalink()` to point across.

**`trigger_id` expires in seconds.** It is your only route to a dialog, it arrives on
slash commands and post action callbacks, and it never arrives from an incoming webhook.
Do your slow work first and call `openDialog()` last.

**Attachments nest differently.** The incoming webhook API takes `attachments` at the top
level. The REST API wants them under `props.attachments`. `createPost()` in
`lib/mattermost.ts` handles this for you, which is why it takes `attachments` directly.

## Checking your work

Press **Check** in the challenge panel. Each check fires its own stimulus, so you do not
need to trigger anything by hand first, and you can re-run it as often as you like.

Failures name the next concrete action rather than restating the rule. If a check says
your handler was never called, that is a Mattermost configuration problem, not a code
problem, and the Inspector will confirm it.
