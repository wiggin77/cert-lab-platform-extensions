/**
 * MODULE 6 SOLUTION  ·  right hand sidebar pane
 *
 * Registered with registry.registerRightHandSidebarComponent(component, title). Unlike a
 * post card, this persists as the user moves around, so it is the right place for detail
 * and for actions that take a moment.
 *
 * Which alert to show comes from the plugin's own redux state, not from props: Mattermost
 * renders this component and has no idea what an alert is. The post card's View Details
 * button is what puts a post id there.
 */

import {useCallback, useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';

import {analyzeAlert, fetchAlert, setAlertStatus} from '../client';
import {alertChanged, getSelectedAlertId} from '../store';
import {severityColor, type AlertRecord} from '../types';

const STATUSES = ['open', 'acknowledged', 'resolved'];

const SKILLS: Array<{id: string; label: string}> = [
    {id: 'analyze_threat_surface', label: 'Analyze Threat Surface'},
    {id: 'suggest_remediation', label: 'Suggest Remediation'},
];

export default function RHSAlert() {
    const dispatch = useDispatch();
    const postId = useSelector(getSelectedAlertId);

    const [alert, setAlert] = useState<AlertRecord | null>(null);
    const [error, setError] = useState('');
    const [busySkill, setBusySkill] = useState('');

    const load = useCallback(async () => {
        if (!postId) {
            setAlert(null);
            return;
        }

        try {
            setAlert(await fetchAlert(postId));
            setError('');
        } catch (err) {
            setAlert(null);
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [postId]);

    useEffect(() => {
        void load();
    }, [load]);

    const changeStatus = async (status: string) => {
        if (!postId) {
            return;
        }

        try {
            await setAlertStatus(postId, status);
            // Re-fetch rather than trusting the local value. What is on screen should be
            // what the server stored, not what we hoped it stored.
            await load();
            // Tell the header widget its count is stale.
            dispatch(alertChanged());
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const runSkill = async (skill: string) => {
        if (!postId) {
            return;
        }

        // A loading state is not decoration here. These calls hit an LLM and take seconds,
        // and without it the button looks broken and gets clicked again.
        setBusySkill(skill);
        try {
            await analyzeAlert(postId, skill);
            setError('');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusySkill('');
        }
    };

    if (!postId) {
        return <div style={{padding: 16}}>{'Select an alert to see its detail.'}</div>;
    }

    if (error && !alert) {
        return <div style={{padding: 16, color: '#D24B4E'}}>{error}</div>;
    }

    if (!alert) {
        return <div style={{padding: 16}}>{'Loading...'}</div>;
    }

    return (
        <div style={{padding: 16}}>
            <div
                style={{
                    background: severityColor(alert.severity),
                    color: '#fff',
                    borderRadius: 4,
                    padding: '2px 8px',
                    display: 'inline-block',
                    fontWeight: 600,
                }}
            >
                {alert.severity}
            </div>

            <dl style={{marginTop: 12}}>
                <dt style={{opacity: 0.7}}>{'Source'}</dt>
                <dd>{alert.source || '(not supplied)'}</dd>
                <dt style={{opacity: 0.7}}>{'Indicator'}</dt>
                <dd style={{fontFamily: 'monospace'}}>{alert.indicator || '(not supplied)'}</dd>
                <dt style={{opacity: 0.7}}>{'Observed'}</dt>
                <dd>{alert.timestamp || '(not supplied)'}</dd>
            </dl>

            <label
                htmlFor='cert-alerts-status'
                style={{display: 'block', marginTop: 12}}
            >
                {'Status'}
            </label>
            <select
                id='cert-alerts-status'
                value={String(alert.status).toLowerCase()}
                onChange={(e) => void changeStatus(e.target.value)}
            >
                {STATUSES.map((status) => (
                    <option
                        key={status}
                        value={status}
                    >
                        {status}
                    </option>
                ))}
            </select>

            <div style={{marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8}}>
                {SKILLS.map((skill) => (
                    <button
                        key={skill.id}
                        className='btn btn-tertiary btn-sm'
                        disabled={busySkill !== ''}
                        onClick={() => void runSkill(skill.id)}
                    >
                        {busySkill === skill.id ? 'Analyzing...' : skill.label}
                    </button>
                ))}
            </div>

            <p style={{marginTop: 12, opacity: 0.7, fontSize: 12}}>
                {'The answer is posted as a reply in the alert’s thread.'}
            </p>

            {error ? <div style={{marginTop: 12, color: '#D24B4E'}}>{error}</div> : null}
        </div>
    );
}
