#!/usr/bin/env bash
#
# On-demand alert trigger. Referenced by the Module 2 lab guide.
#
#   fire-alert.sh                          fire a random alert from the corpus
#   fire-alert.sh --severity CRITICAL      fire a random CRITICAL alert
#   fire-alert.sh --indicator 203.0.113.47 fire the alert carrying that indicator
#   fire-alert.sh --alert-id alert-006     fire one specific alert
#   fire-alert.sh --transport bot_rest     override the transport for this fire
#
set -euo pipefail

LABSVC="${LABSVC_URL:-http://localhost:4000}"
payload='{}'

while [ $# -gt 0 ]; do
    case "$1" in
        --severity)  payload=$(jq -c --arg v "$2" '.severity = $v'  <<<"$payload"); shift 2 ;;
        --indicator) payload=$(jq -c --arg v "$2" '.indicator = $v' <<<"$payload"); shift 2 ;;
        --alert-id)  payload=$(jq -c --arg v "$2" '.alertId = $v'   <<<"$payload"); shift 2 ;;
        --transport) payload=$(jq -c --arg v "$2" '.transport = $v' <<<"$payload"); shift 2 ;;
        -h|--help)   sed -n '2,12p' "$0"; exit 0 ;;
        *)           echo "unknown option: $1" >&2; exit 2 ;;
    esac
done

response=$(curl -sf -m 30 -X POST "${LABSVC}/mock/feed/fire" \
    -H 'content-type: application/json' -d "$payload") || {
    echo "Could not reach the lab service at ${LABSVC}." >&2
    echo "Check it with: sudo systemctl status mm-labsvc" >&2
    exit 1
}

jq -r '"Fired \(.alert.id)  [\(.alert.severity)]  \(.alert.indicator)\n  \(.alert.title)\n  \(.detail)"' <<<"$response"
