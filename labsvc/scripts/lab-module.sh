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

systemctl restart mm-labsvc

for _ in $(seq 1 30); do
    if curl -sf -m 2 "${LABSVC}/healthz" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

if ! curl -sf -m 2 "${LABSVC}/healthz" >/dev/null 2>&1; then
    echo "lab-module: labsvc did not come back up after restart" >&2
    exit 1
fi

curl -sf -m 5 -X POST "${LABSVC}/admin/snapshot?label=module-${MODULE}-start" >/dev/null
curl -sf -m 5 -X POST "${LABSVC}/mock/feed/start" >/dev/null

echo "lab is now on module ${MODULE}"
