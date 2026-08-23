/**
 * MODULE 6 SOLUTION  ·  custom post card
 *
 * Registered with registry.registerPostTypeComponent(type, component). Mattermost renders
 * every post carrying that type with this component instead of its own post renderer.
 *
 * This is not attachment formatting with extra steps. Mattermost skips its own message
 * body entirely for a registered type, including the attachment rendering Module 1 got for
 * free, so the colour bar and the field grid below exist only because they are drawn here.
 *
 * The alert data comes off post.props, put there by the feed. Reading it from the post
 * rather than fetching means the card renders in one pass, with no spinner and no request
 * per post in the channel.
 */

import {useDispatch} from 'react-redux';

import {getShowRHSAction} from '../rhs';
import {selectAlert} from '../store';
import {severityColor, type Post} from '../types';

type Props = {
    post: Post;
};

/** Reads one field out of the feed's attachment. */
function field(post: Post, title: string): string {
    const attachments = (post.props?.attachments ?? []) as Array<{
        fields?: Array<{title?: string; value?: unknown}>;
    }>;

    const found = attachments[0]?.fields?.find(
        (f) => (f.title ?? '').trim().toLowerCase() === title.toLowerCase(),
    );

    // The feed wraps the indicator in backticks so it renders as code. They are
    // formatting, not part of the value.
    return String(found?.value ?? '').trim().replace(/^`|`$/g, '');
}

export default function AlertPost({post}: Props) {
    const dispatch = useDispatch();

    const severity = field(post, 'Severity') || 'INFO';
    const rows: Array<[string, string]> = [
        ['Source', field(post, 'Source')],
        ['Indicator', field(post, 'Indicator')],
        ['Observed', field(post, 'Timestamp')],
    ];

    const viewDetails = () => {
        // Two dispatches: record which alert, then open the pane. The pane reads the
        // selection from the store, so the order matters only in that both must happen.
        dispatch(selectAlert(post.id));

        const show = getShowRHSAction();
        if (show) {
            dispatch(show as never);
        }
    };

    return (
        <div
            style={{
                borderLeft: `4px solid ${severityColor(severity)}`,
                padding: '8px 0 8px 12px',
            }}
        >
            <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
                <span
                    style={{
                        background: severityColor(severity),
                        color: '#fff',
                        borderRadius: 4,
                        padding: '1px 6px',
                        fontSize: 11,
                        fontWeight: 600,
                    }}
                >
                    {severity}
                </span>
                <strong>{'Threat feed alert'}</strong>
            </div>

            <table style={{marginTop: 6, borderSpacing: 0}}>
                <tbody>
                    {rows.map(([label, value]) => (
                        <tr key={label}>
                            <td style={{opacity: 0.7, paddingRight: 12, verticalAlign: 'top'}}>{label}</td>
                            <td style={{fontFamily: label === 'Indicator' ? 'monospace' : undefined}}>
                                {value || '(not supplied)'}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <button
                className='btn btn-primary btn-sm'
                style={{marginTop: 8}}
                onClick={viewDetails}
            >
                {'View Details'}
            </button>
        </div>
    );
}
