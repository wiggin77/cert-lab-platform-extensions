/**
 * Channel header button.
 *
 * Registered with registry.registerChannelHeaderButtonAction(icon, action, dropdownText,
 * tooltipText). The icon argument is a React node, which is what lets this show a live
 * count rather than a static glyph.
 *
 * It is always visible, in every channel, so it is the one place a number can live
 * permanently. That also means it has to stay correct: a count fetched once at load goes
 * stale the first time anybody acknowledges an alert, and the wrongness is on screen for
 * everyone to see.
 *
 * TODO Your task:
 *
 *   - Fetch the count with fetchOpenCount().
 *   - Re-fetch when an alert's status changes in the sidebar pane, so the two agree.
 */

import {useEffect, useState} from 'react';

import {fetchOpenCount} from '../client';

export default function HeaderWidget() {
    const [open, setOpen] = useState<number | null>(null);

    useEffect(() => {
        fetchOpenCount()
            .then((count) => setOpen(count.open))
            .catch(() => setOpen(null));
    }, []);

    return <span>{open === null ? 'Alerts' : `Alerts (${open})`}</span>;
}
