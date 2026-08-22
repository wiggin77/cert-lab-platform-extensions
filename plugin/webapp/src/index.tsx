/**
 * Plugin entry point.
 *
 * Mattermost calls initialize() once, after the webapp has loaded. The registry is how a
 * plugin adds to the interface: each register call returns an id, and each one is an
 * extension point the app already has a slot for. You cannot render into arbitrary parts
 * of the UI, only into the slots the registry exposes.
 *
 * TODO Your task, register three things:
 *
 *   1. The post card, so alerts render as your component instead of an attachment.
 *      Use the post type ALERT_POST_TYPE below.
 *   2. The right hand sidebar pane, for full detail and status changes.
 *   3. The channel header button, showing the open alert count.
 *
 * The method names are in the component files, along with what each one expects.
 *
 * After `make deploy`, reload the browser tab. The old bundle is cached, and a stale
 * bundle looks exactly like code that does not work.
 */

import AlertPost from './components/alert_post';
import HeaderWidget from './components/header_widget';
import RHSAlert from './components/rhs_alert';
import type {PluginRegistry} from './types';

/**
 * The post type the server side sets on captured alerts.
 *
 * A post type is what connects a post to a component. Mattermost renders a post with a
 * registered custom type using that component and ignores the message body, which is why
 * the server sets this and why the two strings have to match exactly.
 */
export const ALERT_POST_TYPE = 'custom_soc_alert';

class AlertsPlugin {
    public initialize(registry: PluginRegistry, store: unknown): void {
        // Referenced so the build keeps them while they are not registered yet. Delete
        // this line once you have wired the three register calls below.
        void [AlertPost, RHSAlert, HeaderWidget, store];

        // Your three register calls go here.
    }

    public uninitialize(): void {
        // Nothing to tear down. Anything the registry returned is cleaned up for us.
    }
}

declare global {
    interface Window {
        registerPlugin(id: string, plugin: AlertsPlugin): void;
    }
}

window.registerPlugin('com.mattermost.cert-alerts', new AlertsPlugin());
