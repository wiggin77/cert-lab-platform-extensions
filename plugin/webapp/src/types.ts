/** Shapes shared by the components. These mirror the Go structs in server/kvstore.go. */

export type AlertStatus = 'open' | 'acknowledged' | 'resolved';

export type AlertRecord = {
    post_id: string;
    channel_id: string;
    severity: string;
    source: string;
    indicator: string;
    timestamp: string;
    status: AlertStatus | string;
};

export type AlertCount = {
    open: number;
};

/**
 * The subset of the plugin registry this plugin uses.
 *
 * The real registry has many more methods. Typing only what is used here keeps the
 * compiler useful without vendoring the whole webapp's types.
 */
export type PluginRegistry = {
    registerPostTypeComponent(type: string, component: React.ComponentType<{post: Post}>): string;
    registerRightHandSidebarComponent(
        component: React.ComponentType<Record<string, never>>,
        title: React.ReactNode,
    ): {id: string; showRHSPlugin: {type: string}; hideRHSPlugin: {type: string}; toggleRHSPlugin: {type: string}};
    registerChannelHeaderButtonAction(
        icon: React.ReactNode,
        action: () => void,
        dropdownText: React.ReactNode,
        tooltipText: React.ReactNode,
    ): string;
    registerReducer(reducer: unknown): void;
};

export type Post = {
    id: string;
    channel_id: string;
    message: string;
    type: string;
    props: Record<string, unknown>;
};

/** Colour per severity, matching what the server side feed uses. */
export const SEVERITY_COLORS: Record<string, string> = {
    CRITICAL: '#D24B4E',
    HIGH: '#F5AB00',
    MEDIUM: '#FFBC1F',
    LOW: '#3DB887',
    INFO: '#1C58D9',
};

export function severityColor(severity: string): string {
    return SEVERITY_COLORS[(severity || '').toUpperCase()] ?? '#8B8D94';
}
