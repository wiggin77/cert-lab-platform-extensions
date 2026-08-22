/**
 * Right hand sidebar pane.
 *
 * Registered with registry.registerRightHandSidebarComponent(component, title). Unlike a
 * post card, this persists as the user moves around, so it is the right place for detail
 * and for actions that take a moment.
 *
 * TODO Your task:
 *
 *   - Fetch the record with fetchAlert(postId) when the pane opens, and show every field.
 *   - Add a status selector calling setAlertStatus(postId, status), then re-fetch so what
 *     is on screen is what the server actually stored, rather than what you hoped it did.
 *   - Add two buttons, Analyze Threat Surface and Suggest Remediation, calling
 *     analyzeAlert(postId, skill). Show a loading state: these call an LLM and are not
 *     instant. The reply is posted server side, threaded under the alert.
 *
 * Which alert to show has to come from somewhere. The post card's View Details button is
 * the trigger, so it needs to record the post id where this component can read it. A
 * small plugin reducer registered with registry.registerReducer is the idiomatic answer.
 */

import {useCallback, useEffect, useState} from 'react';

import {fetchAlert} from '../client';
import type {AlertRecord} from '../types';

type Props = {
    postId?: string;
};

export default function RHSAlert({postId}: Props) {
    const [alert, setAlert] = useState<AlertRecord | null>(null);
    const [error, setError] = useState<string>('');

    const load = useCallback(async () => {
        if (!postId) {
            return;
        }

        try {
            setAlert(await fetchAlert(postId));
            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [postId]);

    useEffect(() => {
        void load();
    }, [load]);

    if (!postId) {
        return <div style={{padding: 16}}>{'Select an alert to see its detail.'}</div>;
    }

    if (error) {
        return <div style={{padding: 16, color: '#D24B4E'}}>{error}</div>;
    }

    if (!alert) {
        return <div style={{padding: 16}}>{'Loading...'}</div>;
    }

    return (
        <div style={{padding: 16}}>
            <strong>{alert.severity}</strong>
            <div>{'Replace this placeholder with the full detail pane.'}</div>
        </div>
    );
}
