---
slug: actions-and-dialogs
id: 02pp3prhslze
type: challenge
title: Post Actions and Dialogs
teaser: Add an Escalate button that opens a form and posts a structured escalation.
notes:
- type: text
  contents: |-
    The automatic escalation from Module 3 catches CRITICAL alerts, but it carries no
    analyst judgement. It cannot say which systems are affected, who is picking it
    up, or what the responder already ruled out.

    This challenge adds an Escalate button to the alert itself. Clicking it opens a
    form. Submitting the form posts a structured escalation with the analyst's own
    assessment attached.
tabs:
- id: nunxbcg0dxlx
  title: Mattermost
  type: service
  hostname: workbench
  port: 8065
- id: fc3jvsuvpxn9
  title: Editor
  type: code
  hostname: workbench
  path: /home/learner/handler
- id: qlc3yjywsjyx
  title: Lab Inspector
  type: service
  hostname: workbench
  path: /inspector
  port: 4000
- id: nzt9bw137sns
  title: Terminal
  type: terminal
  hostname: workbench
difficulty: intermediate
timelimit: 2700
enhanced_loading: null
---

Nothing to configure in Mattermost for this one. Interactive elements are declared in the
message itself, so all the work is in code.

# Your task

## 1. Add the button

Back in `src/payloads/alert-payload.ts`, add an `actions` array to the attachment. There
is a `button()` helper in `src/lib/attachments.ts`:

```ts
actions: [
    button('Escalate', `${config.publicBaseUrl}/actions/escalate`, {
        post_id: '...',
        indicator: alert.indicator,
    }, 'danger'),
]
```

Whatever you put in the integration `context` comes back to you on click, and is never
visible to the user.

## 2. Open a dialog on click

Edit `src/routes/post-action.ts`. Build the dialog and call `openDialog()` with
`payload.trigger_id`, pointing the callback at
`http://workbench:4000/dialogs/escalate/submit`.

The dialog needs exactly four elements:

| Display name | Type | Detail |
|---|---|---|
| Severity | `select` | options `CRITICAL`, `HIGH`, `MEDIUM` |
| Affected Systems | `text` | |
| Assignee | `text` | |
| Notes | `textarea` | |

Put the originating post id in the dialog's `state`. It round trips to your submission
handler unchanged, which is how you know which alert was escalated.

## 3. Handle the submission

Edit `src/routes/dialog-submit.ts`:

1. Return early if `payload.cancelled`.
2. **Validate**: Severity and Affected Systems must not be empty. Return
   `{errors: {<element name>: 'message'}}` to keep the dialog open with the message
   under that field.
3. On a valid submission, post the escalation to `~incidents` with every form field,
   the submitting analyst, a timestamp, and a permalink to the original alert.

## 4. Test it

```bash
fire-alert.sh --severity CRITICAL
```

Click **Escalate** on the alert. Submit the form once with Severity blank, then again
filled in.

# Worth knowing

**`trigger_id` expires within seconds.** It is your only route to a dialog, it arrives on
slash commands and action callbacks, and never on an incoming webhook. Do slow work
first and call `openDialog()` last. A dialog that never appears is usually an expired
trigger.

**Key your errors by the element's `name`, not its `display_name`.** Getting this wrong
produces validation that silently never shows.

**Returning a non-2xx loses everything the analyst typed.** Return 200 with `errors`
instead.
