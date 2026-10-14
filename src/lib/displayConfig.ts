// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Mutter.DisplayConfig';
const OBJECT_PATH = '/org/gnome/Mutter/DisplayConfig';

const COLOR_MODE_DEFAULT = 0;
const COLOR_MODE_BT2100 = 1;
const METHOD_PERSISTENT = 2;

// The unpacked shape of GetCurrentState's (ua((ssss)a(siiddada{sv})a{sv})a(iiduba(ssss)a{sv})a{sv}).
type MonitorSpec = [connector: string, vendor: string, product: string, serial: string];
type Mode = [
    id: string,
    width: number,
    height: number,
    refreshRate: number,
    preferredScale: number,
    supportedScales: number[],
    properties: { 'is-current'?: boolean },
];
type MonitorProperties = {
    'color-mode'?: number;
    'supported-color-modes'?: number[];
    'rgb-range'?: number;
};
type Monitor = [spec: MonitorSpec, modes: Mode[], properties: MonitorProperties];
type LogicalMonitor = [
    x: number,
    y: number,
    scale: number,
    transform: number,
    primary: boolean,
    monitors: MonitorSpec[],
    properties: Record<string, unknown>,
];
type MonitorConfig = [connector: string, modeId: string, options: Record<string, GLib.Variant>];
type LogicalMonitorConfig = [
    x: number,
    y: number,
    scale: number,
    transform: number,
    primary: boolean,
    monitors: MonitorConfig[],
];
type CurrentState = [
    serial: number,
    monitors: Monitor[],
    logicalMonitors: LogicalMonitor[],
    properties: { 'layout-mode'?: number; 'supports-changing-layout-mode'?: boolean },
];

export interface MonitorInfo {
    connector: string;
    active: boolean;
    hdrSupported: boolean;
    hdrEnabled: boolean;
}

// Always asynchronous: the shell itself owns this name, so a sync call would deadlock it.
function call<T>(method: string, parameters: GLib.Variant | null = null): Promise<T> {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            BUS_NAME,
            OBJECT_PATH,
            BUS_NAME,
            method,
            parameters,
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            -1,
            null,
            (connection, res) => {
                try {
                    resolve(connection?.call_finish(res).recursiveUnpack() as T);
                } catch (e) {
                    reject(e);
                }
            },
        );
    });
}

const isCurrent = (mode: Mode) => mode[6]['is-current'] === true;

// Matches the EDID product name rather than a port, so another monitor on that port is never driven.
export async function findMonitor(product: string): Promise<MonitorInfo | null> {
    const [, monitors] = await call<CurrentState>('GetCurrentState');
    const match = monitors.find(([spec]) => spec[2].trim() === product);
    if (!match) return null;
    const [[connector], modes, properties] = match;
    return {
        connector,
        active: modes.some(isCurrent),
        hdrSupported: properties['supported-color-modes']?.includes(COLOR_MODE_BT2100) ?? false,
        hdrEnabled: properties['color-mode'] === COLOR_MODE_BT2100,
    };
}

// Re-applies the current layout unchanged except for one monitor's color mode. Persistent, so
// the monitor re-linking (which HDR preset changes cause) does not revert it.
export async function setHdr(connector: string, enabled: boolean): Promise<void> {
    const [serial, monitors, logicalMonitors, properties] =
        await call<CurrentState>('GetCurrentState');
    const byConnector = new Map(
        monitors.map(([spec, modes, props]) => [spec[0], { modes, props }]),
    );

    const monitorConfig = (name: string): MonitorConfig => {
        const monitor = byConnector.get(name);
        const currentMode = monitor?.modes.find(isCurrent);
        if (!monitor || !currentMode) throw new Error(`${name} has no current mode`);
        const options: Record<string, GLib.Variant> = {};
        const colorMode =
            name === connector
                ? enabled
                    ? COLOR_MODE_BT2100
                    : COLOR_MODE_DEFAULT
                : monitor.props['color-mode'];
        if (colorMode !== undefined) options['color-mode'] = new GLib.Variant('u', colorMode);
        const rgbRange = monitor.props['rgb-range'];
        if (rgbRange !== undefined) options['rgb-range'] = new GLib.Variant('u', rgbRange);
        return [name, currentMode[0], options];
    };

    const layout = logicalMonitors.map(
        ([x, y, scale, transform, primary, specs]): LogicalMonitorConfig => [
            x,
            y,
            scale,
            transform,
            primary,
            specs.map(([name]) => monitorConfig(name)),
        ],
    );
    const layoutProperties: Record<string, GLib.Variant> = {};
    const layoutMode = properties['layout-mode'];
    if (properties['supports-changing-layout-mode'] && layoutMode !== undefined)
        layoutProperties['layout-mode'] = new GLib.Variant('u', layoutMode);

    await call(
        'ApplyMonitorsConfig',
        new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
            serial,
            METHOD_PERSISTENT,
            layout,
            layoutProperties,
        ]),
    );
}
