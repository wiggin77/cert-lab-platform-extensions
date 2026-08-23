/**
 * MODULE 6 SOLUTION  ·  plugin entry point
 *
 * Mattermost calls initialize() once, after the webapp has loaded. The registry is how a
 * plugin adds to the interface: each register call returns an id, and each one is an
 * extension point the app already has a slot for. You cannot render into arbitrary parts
 * of the UI, only into the slots the registry exposes.
 */

import AlertPost from './components/alert_post';
import HeaderWidget from './components/header_widget';
import RHSAlert from './components/rhs_alert';
import {setShowRHSAction} from './rhs';
import reducer from './store';
import type {PluginRegistry} from './types';

/**
 * The post type the server side sets on captured alerts.
 *
 * A post type is what connects a post to a component. Mattermost renders a post with a
 * registered custom type using that component instead of its own renderer, which is why
 * the server sets this and why the two strings have to match exactly.
 */
export const ALERT_POST_TYPE = 'custom_soc_alert';

type Store = {
    dispatch: (action: unknown) => unknown;
};

class AlertsPlugin {
    public initialize(registry: PluginRegistry, store: Store): void {
        // First, because the components below read from this state as soon as they mount.
        registry.registerReducer(reducer);

        // The sidebar pane. Registering it returns the actions that open and close it, and
        // this is the only moment they are available, so stash the one we need.
        const rhs = registry.registerRightHandSidebarComponent(RHSAlert, 'Alert detail');
        setShowRHSAction(rhs.showRHSPlugin);

        // The post card. Every post carrying ALERT_POST_TYPE now renders as AlertPost.
        registry.registerPostTypeComponent(ALERT_POST_TYPE, AlertPost);

        // The channel header widget. The icon is a React node rather than a glyph name,
        // which is what lets it show a live count.
        registry.registerChannelHeaderButtonAction(
            <HeaderWidget/>,
            () => store.dispatch(rhs.showRHSPlugin),
            'Open alerts',
            'Open alerts',
        );
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
