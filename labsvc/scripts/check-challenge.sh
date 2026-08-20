#!/usr/bin/env bash
#
# Template for an Instruqt check-<host> script.
#
# Copy into a challenge directory as check-workbench and set MODULE / CHALLENGE, or call
# it with two arguments. Instruqt shows this script's stdout to the learner when the check
# fails, so everything printed here should be something they can act on.
#
set -euo pipefail

MODULE="${1:-${MODULE:?set MODULE or pass it as the first argument}}"
CHALLENGE="${2:-${CHALLENGE:-1}}"
LABSVC="${LABSVC_URL:-http://localhost:4000}"

if ! curl -sf -m 5 "${LABSVC}/healthz" >/dev/null; then
    echo "The lab service is not responding at ${LABSVC}."
    echo
    echo "Restart it with:"
    echo "    sudo systemctl restart mm-labsvc"
    exit 1
fi

report=$(curl -s -m 120 -X POST "${LABSVC}/grader/run/${MODULE}/${CHALLENGE}") || {
    echo "The grader did not complete. Check: sudo journalctl -u mm-labsvc -n 50"
    exit 1
}

if ! jq -e '.checks' >/dev/null 2>&1 <<<"$report"; then
    echo "The grader returned an unexpected response:"
    echo "$report"
    exit 1
fi

jq -r '
  .checks[]
  | (if .ok then "PASS  " else "FAIL  " end) + .title
    + "\n        " + .detail
    + (if .ok then "" else "\n        -> " + (.hint // "See the Lab Inspector for detail.") end)
' <<<"$report"

if [ "$(jq -r '.journalChainBrokenAt // "null"' <<<"$report")" != "null" ]; then
    echo
    echo "Note: the lab service journal chain is inconsistent. Grading still used live"
    echo "Mattermost state, so this does not affect the result."
fi

if [ "$(jq -r '.pass' <<<"$report")" = "true" ]; then
    exit 0
fi

echo
echo "Inspect the traffic at \${LABSVC_PUBLIC_BASE_URL}/inspector"
exit 1
