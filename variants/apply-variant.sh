#!/usr/bin/env bash
#
# Overlays a module variant onto the learner's code.
#
#   apply-variant.sh mod3 solution     put the worked solution in place
#   apply-variant.sh mod3 starter      restore the starter (if one is recorded)
#
# Instruqt solve-<host> scripts call this with `solution`. CI calls it for every module in
# turn and runs that module's checks, which is what stops the track rotting as the
# codebase moves underneath it.
#
# Destination: modules 2 to 5 edit the handler, module 6 edits the plugin. Rather than
# infer that from the module name, each variant declares where it goes in a `dest` file
# holding either `handler` or `plugin`. Explicit, because a variant copied into the wrong
# tree fails later and somewhere else, as a compile error in code nobody touched.
#
set -euo pipefail

MODULE="${1:?usage: apply-variant.sh <module> <starter|solution>}"
VARIANT="${2:-solution}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${HERE}/${MODULE}/${VARIANT}"

HANDLER_DIR="${HANDLER_DIR:-/home/learner/handler}"
PLUGIN_DIR="${PLUGIN_DIR:-/home/learner/plugin}"

if [ ! -d "$SRC" ]; then
    echo "No such variant: ${MODULE}/${VARIANT}" >&2
    echo "Available:" >&2
    find "$HERE" -mindepth 2 -maxdepth 2 -type d -printf '  %P\n' | sort >&2
    exit 1
fi

# `dest` sits alongside the variant's files, not inside them, so it is never copied.
DEST_KIND="handler"
if [ -f "${HERE}/${MODULE}/dest" ]; then
    DEST_KIND="$(tr -d '[:space:]' < "${HERE}/${MODULE}/dest")"
fi

case "$DEST_KIND" in
    handler) DEST="$HANDLER_DIR" ;;
    plugin)  DEST="$PLUGIN_DIR" ;;
    *)
        echo "Unknown destination '${DEST_KIND}' in ${HERE}/${MODULE}/dest" >&2
        echo "Expected 'handler' or 'plugin'." >&2
        exit 1
        ;;
esac

if [ ! -d "$DEST" ]; then
    echo "Destination directory not found: ${DEST} (variant targets the ${DEST_KIND})" >&2
    echo "Set ${DEST_KIND^^}_DIR if it lives somewhere else." >&2
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
