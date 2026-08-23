/**
 * MODULE 6 SOLUTION  ·  plugin redux state
 *
 * The post card and the sidebar pane are rendered in different parts of the app and never
 * see each other, so "which alert is selected" cannot live in either one's props. A plugin
 * reducer is the idiomatic place for it.
 *
 * Mattermost namespaces a plugin's state under `plugins-<plugin id>`, so the selectors
 * below are the only place that key appears.
 */

import {combineReducers} from 'redux';

import {PLUGIN_ID} from './client';

export const SELECT_ALERT = `${PLUGIN_ID}/SELECT_ALERT`;
export const ALERT_CHANGED = `${PLUGIN_ID}/ALERT_CHANGED`;

type SelectAlertAction = {type: string; postId: string};

export function selectAlert(postId: string): SelectAlertAction {
    return {type: SELECT_ALERT, postId};
}

/**
 * Signals that an alert's status changed.
 *
 * The channel header count is fetched from the server, so nothing tells it that a status
 * changed in the sidebar. Bumping a counter here gives it something to watch. Without it
 * the number stays wrong until a page reload, which is the kind of stale UI that makes
 * people distrust the whole widget.
 */
export function alertChanged(): {type: string} {
    return {type: ALERT_CHANGED};
}

function selectedAlertId(state = '', action: SelectAlertAction): string {
    if (action.type === SELECT_ALERT) {
        return action.postId;
    }
    return state;
}

function changeCount(state = 0, action: {type: string}): number {
    if (action.type === ALERT_CHANGED) {
        return state + 1;
    }
    return state;
}

export default combineReducers({selectedAlertId, changeCount});

type PluginState = {
    selectedAlertId: string;
    changeCount: number;
};

type GlobalState = {
    [key: string]: unknown;
};

function pluginState(state: GlobalState): PluginState {
    return (state[`plugins-${PLUGIN_ID}`] as PluginState) ?? {selectedAlertId: '', changeCount: 0};
}

export function getSelectedAlertId(state: GlobalState): string {
    return pluginState(state).selectedAlertId;
}

export function getChangeCount(state: GlobalState): number {
    return pluginState(state).changeCount;
}
