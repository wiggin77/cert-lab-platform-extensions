#!/usr/bin/env bash
#
# Overlays a module variant onto the handler.
#
#   apply-variant.sh mod3 solution     put the worked solution in place
#   apply-variant.sh mod3 starter      restore the starter (if one is recorded)
#
# Instruqt solve-<host> scripts call this with `solution`. CI calls it for every module in
# turn and runs that module's checks, which is what stops the track rotting as the
# codebase moves underneath it.
#
set -euo pipefail

MODULE="${1:?usage: apply-variant.sh <module> <starter|solution>}"
VARIANT="${2:-solution}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${HERE}/${MODULE}/${VARIANT}"
DEST="${HANDLER_DIR:-/home/learner/handler}"

if [ ! -d "$SRC" ]; then
    echo "No such variant: ${MODULE}/${VARIANT}" >&2
    echo "Available:" >&2
    find "$HERE" -mindepth 2 -maxdepth 2 -type d -printf '  %P\n' | sort >&2
    exit 1
fi

if [ ! -d "$DEST" ]; then
    echo "Handler directory not found: ${DEST}" >&2
    echo "Set HANDLER_DIR if it lives somewhere else." >&2
    exit 1
fi

# Copy only the files this variant defines. Everything else is left alone, so applying
# mod3 does not undo the learner's own Module 2 work.
copied=0
while IFS= read -r -d '' file; do
    rel="${file#"$SRC"/}"
    mkdir -p "${DEST}/$(dirname "$rel")"
    cp "$file" "${DEST}/${rel}"
    echo "  ${rel}"
    copied=$((copied + 1))
done < <(find "$SRC" -type f -print0)

echo "Applied ${MODULE}/${VARIANT}: ${copied} file(s) into ${DEST}"
