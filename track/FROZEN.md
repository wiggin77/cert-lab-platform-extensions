# This directory is frozen

Superseded by `tracks/`, which holds the six per-module tracks this one was split into.

**Do not edit anything here.** It is kept only as the rollback until the six new tracks are
verified end to end on Instruqt, and it is deleted after that. A fix that lands here is
invisible to `bin/check-track-drift`, which only scans `tracks/`, and it is lost when this
directory goes.

The remote `platform-extensions` track is likewise left in place, and running, until the
replacements are verified.

See `implementation-plans/split-into-per-module-tracks.md`.
