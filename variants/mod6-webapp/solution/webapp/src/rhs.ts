/**
 * MODULE 6 SOLUTION  ·  opening the sidebar from anywhere
 *
 * registerRightHandSidebarComponent hands back the actions that open and close the pane,
 * but only at registration time, inside initialize(). The post card is rendered later and
 * somewhere else entirely, so it needs a way to reach them.
 *
 * A module level holder is the simplest thing that works. The alternative, threading the
 * action down through props, is not available: Mattermost constructs the post component,
 * not us.
 */

/** Redux action that opens the plugin's sidebar pane. Set once, in initialize(). */
let showRHSAction: unknown = null;

export function setShowRHSAction(action: unknown): void {
    showRHSAction = action;
}

export function getShowRHSAction(): unknown {
    return showRHSAction;
}
