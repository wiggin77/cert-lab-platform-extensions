#!/usr/bin/env bash
#
# Switches the lab environment to a given module.
#
# Called from each challenge's setup-workbench script. LAB_MODULE is not cosmetic: it
# selects the mock feed's transport (incoming webhook for Module 2, REST as a bot from
# Module 3 on, because incoming webhook posts do not fire outgoing webhook triggers) and
# it tags journal events. See DESIGN.md section 5.1.
#
# Also takes a snapshot, so the next challenge's cleanup has a watermark to reset to.
#
set -euo pipefail

MODULE="${1:?usage: lab-module.sh <module>}"
LAB_ENV="${LAB_ENV:-/etc/lab.env}"
LABSVC="${LABSVC_URL:-http://localhost:4000}"

if [ ! -f "$LAB_ENV" ]; then
    echo "lab-module: ${LAB_ENV} does not exist. Track setup has not run." >&2
    exit 1
fi

if grep -q '^LAB_MODULE=' "$LAB_ENV"; then
    sed -i "s/^LAB_MODULE=.*/LAB_MODULE=${MODULE}/" "$LAB_ENV"
else
    echo "LAB_MODULE=${MODULE}" >> "$LAB_ENV"
fi

# Retried, and verified by the main PID changing rather than by a health check alone.
#
# `systemctl restart` exits non-zero when systemd supersedes a pending job for the same
# unit, and under `set -e` that killed this script outright. Worse, if every restart is
# superseded the old process keeps serving with the previous LAB_MODULE, so /healthz
# answers and nothing looks wrong while the feed is on the wrong transport.
BEFORE_PID=$(systemctl show -p MainPID --value mm-labsvc 2>/dev/null || echo 0)

for attempt in 1 2 3; do
    if systemctl restart mm-labsvc 2>/dev/null; then
        break
    fi
    echo "lab-module: restart of mm-labsvc was superseded (attempt ${attempt}), retrying" >&2
    sleep 2
done

restarted=false
for _ in $(seq 1 30); do
    NOW_PID=$(systemctl show -p MainPID --value mm-labsvc 2>/dev/null || echo 0)
    if [ "$NOW_PID" != "0" ] && [ "$NOW_PID" != "$BEFORE_PID" ] &&
        curl -sf -m 2 "${LABSVC}/healthz" >/dev/null 2>&1; then
        restarted=true
        break
    fi
    sleep 1
done

if [ "$restarted" != true ]; then
    echo "lab-module: mm-labsvc did not restart onto module ${MODULE}" >&2
    echo "lab-module: check journalctl -u mm-labsvc -n 50" >&2
    exit 1
fi

curl -sf -m 5 -X POST "${LABSVC}/admin/snapshot?label=module-${MODULE}-start" >/dev/null
curl -sf -m 5 -X POST "${LABSVC}/mock/feed/start" >/dev/null

echo "lab is now on module ${MODULE}"
