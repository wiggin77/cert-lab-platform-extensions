#!/usr/bin/env bash
#
# Shared helpers for the lab-* scripts. Sourced, not executed.

LAB_ENV="${LAB_ENV:-/etc/lab.env}"
MM="${MM_URL:-http://mattermost:8065}"
LABSVC="${LABSVC_URL:-http://localhost:4000}"

log()  { echo "[${SCRIPT_NAME:-lab}] $*"; }
warn() { echo "[${SCRIPT_NAME:-lab}] WARNING: $*" >&2; }
die()  { echo "[${SCRIPT_NAME:-lab}] ERROR: $*" >&2; exit 1; }

require_root() {
    [ "$(id -u)" -eq 0 ] || die "must run as root. Try: sudo $0 $*"
}

# ---------------------------------------------------------------------------
# /etc/lab.env
# ---------------------------------------------------------------------------

# Upsert a key. Idempotent, so setup can re-run without duplicating lines.
lab_env_set() {
    local key="$1" value="$2"
    touch "$LAB_ENV"
    if grep -q "^${key}=" "$LAB_ENV"; then
        # `key=value` may contain slashes and ampersands, so avoid sed substitution.
        local tmp
        tmp=$(mktemp)
        grep -v "^${key}=" "$LAB_ENV" > "$tmp"
        printf '%s=%s\n' "$key" "$value" >> "$tmp"
        cat "$tmp" > "$LAB_ENV"
        rm -f "$tmp"
    else
        printf '%s=%s\n' "$key" "$value" >> "$LAB_ENV"
    fi
}

lab_env_get() {
    [ -f "$LAB_ENV" ] || return 1
    sed -n "s/^$1=//p" "$LAB_ENV" | tail -1
}

# ---------------------------------------------------------------------------
# Mattermost API
# ---------------------------------------------------------------------------

wait_for_mattermost() {
    local tries="${1:-90}"
    for _ in $(seq 1 "$tries"); do
        curl -sf -m 3 "${MM}/api/v4/system/ping" >/dev/null 2>&1 && return 0
        sleep 2
    done
    die "Mattermost never became ready at ${MM}"
}

# mm <METHOD> <PATH> [JSON_BODY]
#
# Prints the response body. Returns non-zero on a 4xx/5xx, so callers can decide whether
# a conflict is fatal. Requires MM_ADMIN_TOKEN in the environment.
mm() {
    local method="$1" path="$2" body="${3:-}"
    local args=(-sS -m 30 -X "$method" "${MM}/api/v4${path}"
                -H "Authorization: Bearer ${MM_ADMIN_TOKEN}"
                -w '\n%{http_code}')
    [ -n "$body" ] && args+=(-H 'Content-Type: application/json' -d "$body")

    local out code
    out=$(curl "${args[@]}") || return 1
    code=$(printf '%s' "$out" | tail -1)
    printf '%s' "$out" | sed '$d'

    [ "$code" -ge 200 ] && [ "$code" -lt 300 ]
}

# Same, but a 400-level response is treated as success. For create calls where the object
# may already exist and re-running setup must not fail.
mm_ok_if_exists() {
    mm "$@" || true
}

json_get() { python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$1',''))" 2>/dev/null; }
