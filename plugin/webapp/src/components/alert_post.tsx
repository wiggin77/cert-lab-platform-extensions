/**
 * Custom post card.
 *
 * Registered with registry.registerPostTypeComponent(type, component). Mattermost then
 * renders every post carrying that type with this component, instead of its own post
 * renderer.
 *
 * This is not attachment formatting with extra steps. There is no colour bar or field
 * grid unless you draw one: you own the whole render, including the layout Module 2's
 * attachments gave you for free.
 *
 * The alert data is on the post, in post.props, put there by the server side hook. Read
 * it from there rather than fetching, so the card renders in one pass with no spinner.
 *
 * TODO Your task:
 *
 *   - Show the severity, source, indicator, and timestamp.
 *   - Use severityColor(severity) for a coloured left edge, so severity reads at a glance.
 *   - Add a View Details button that opens the sidebar pane.
 */

import {severityColor, type Post} from '../types';

type Props = {
    post: Post;
};

export default function AlertPost({post}: Props) {
    const severity = String(post.props?.alert_severity ?? 'INFO');

    return (
        <div style={{borderLeft: `4px solid ${severityColor(severity)}`, paddingLeft: 12}}>
            <strong>{severity}</strong>
            {' alert. Replace this placeholder with the real card.'}
        </div>
    );
}
