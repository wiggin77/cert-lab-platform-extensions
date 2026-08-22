/**
 * MODULE 6 SOLUTION, challenge 2  ·  channel header widget
 *
 * Registered with registry.registerChannelHeaderButtonAction(icon, action, dropdownText,
 * tooltipText). The icon argument is a React node, which is what lets this show a live
 * count rather than a static glyph.
 *
 * It is always visible, in every channel, so it is the one place a number can live
 * permanently. That also means it has to stay correct. A count fetched once at mount goes
 * stale the moment anybody acknowledges an alert, and the wrongness is on screen for
 * everyone, which is worse than showing nothing.
 *
 * The sidebar pane dispatches alertChanged() after a status update. Watching that counter
 * is what keeps the two in agreement without polling.
 */

import {useEffect, useState} from 'react';
import {useSelector} from 'react-redux';

import {fetchOpenCount} from '../client';
import {getChangeCount} from '../store';

export default function HeaderWidget() {
    const [open, setOpen] = useState<number | null>(null);
    const changeCount = useSelector(getChangeCount);

    useEffect(() => {
        let cancelled = false;

        fetchOpenCount()
            .then((count) => {
                if (!cancelled) {
                    setOpen(count.open);
                }
            })
            .catch(() => {
                // A failed count is not worth an error state in the header. Showing the
                // plain label is the honest fallback.
                if (!cancelled) {
                    setOpen(null);
                }
            });

        // Guards against a slow first response landing after a newer one and overwriting
        // it with an older number.
        return () => {
            cancelled = true;
        };
    }, [changeCount]);

    if (open === null) {
        return <span>{'Alerts'}</span>;
    }

    return (
        <span>
            {'Alerts'}
            <span
                style={{
                    marginLeft: 6,
                    background: open > 0 ? '#D24B4E' : '#3DB887',
                    color: '#fff',
                    borderRadius: 10,
                    padding: '0 7px',
                    fontSize: 11,
                    fontWeight: 600,
                }}
            >
                {open}
            </span>
        </span>
    );
}
