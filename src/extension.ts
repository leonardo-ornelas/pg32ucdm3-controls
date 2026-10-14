// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import type St from 'gi://St';

import { gettext as _, Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {
    QuickMenuToggle,
    type QuickSettingsItem,
    QuickSlider,
    QuickToggle,
    SystemIndicator,
} from 'resource:///org/gnome/shell/ui/quickSettings.js';

import { Ddc } from './lib/ddc.js';
import * as DisplayConfig from './lib/displayConfig.js';
import {
    CONSOLE_HDR,
    GAMEVISUAL_MODES,
    HDR_FLAG_BOOST,
    HDR_PRESETS,
    PRODUCT,
    type Preset,
    VCP,
    type VcpCode,
} from './lib/model.js';

const BRIGHTNESS_STEP = 0.05;
const SETTLE_SECONDS = 3;

// Not in the published GNOME Shell type definitions; the handlers are private.
interface BrightnessManager {
    globalScale: object | null;
    _screenBrightnessUp?: () => void;
    _screenBrightnessDown?: () => void;
}
const brightnessManager = () =>
    (Main as unknown as { brightnessManager: BrightnessManager }).brightnessManager;

const logError = (e: unknown) =>
    console.error(`${PRODUCT} controls: ${e instanceof Error ? e.message : e}`);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function monitorIndex(connector: string | null): number {
    return connector
        ? global.backend.get_monitor_manager().get_monitor_for_connector(connector)
        : -1;
}

// GNOME's own brightness-key handler, which only ever drives the built-in panel.
function builtinBrightnessKey(direction: number) {
    const manager = brightnessManager();
    const handler = direction > 0 ? manager._screenBrightnessUp : manager._screenBrightnessDown;
    if (!handler) throw new Error('GNOME brightness handlers not found');
    handler.call(manager);
}

class BrightnessSlider extends QuickSlider {
    static {
        GObject.registerClass(BrightnessSlider);
    }

    private _ddc: Ddc;
    private _locked = false;
    private _pending: number | null = null;
    private _writing = false;
    private _osdIcon: Gio.Icon;
    private _valueId: number;

    constructor(ddc: Ddc) {
        super({ iconName: 'display-brightness-symbolic' });
        this._ddc = ddc;
        this._osdIcon = Gio.Icon.new_for_string('display-brightness-symbolic');
        this.slider.accessible_name = _('Monitor brightness');
        this._valueId = this.slider.connect('notify::value', () => {
            this._showOsd();
            this._queueWrite();
        });
    }

    private _showOsd() {
        const index = monitorIndex(this._ddc.connector);
        if (index >= 0)
            Main.osdWindowManager.showOne(index, this._osdIcon, null, this.slider.value);
    }

    setValue(value: number) {
        if (this._writing) return;
        this.slider.block_signal_handler(this._valueId);
        this.slider.value = value;
        this.slider.unblock_signal_handler(this._valueId);
    }

    // The monitor rejects brightness writes in HDR, so the slider only reports the value there.
    setLocked(locked: boolean) {
        this._locked = locked;
        this.slider.reactive = !locked;
    }

    step(direction: number) {
        const value = clamp(this.slider.value + direction * BRIGHTNESS_STEP, 0, 1);
        if (this._locked || value === this.slider.value) this._showOsd();
        else this.slider.value = value;
    }

    // A drag fires far faster than the monitor accepts writes; only the latest value is sent.
    private async _queueWrite() {
        this._pending = Math.round(this.slider.value * 100);
        if (this._writing) return;
        this._writing = true;
        while (this._pending !== null) {
            const value = this._pending;
            this._pending = null;
            await this._ddc.set(VCP.BRIGHTNESS, value).catch(logError);
        }
        this._writing = false;
    }
}

interface PresetToggleParams {
    ddc: Ddc;
    title: string;
    iconName: string;
    code: VcpCode;
    presets: readonly Preset[];
    onChanged: () => void;
}

class PresetToggle extends QuickMenuToggle {
    static {
        GObject.registerClass(PresetToggle);
    }

    protected _ddc: Ddc;
    private _code: VcpCode;
    private _presets: readonly Preset[];
    private _onChanged: () => void;
    private _body: St.Button;
    private _arrow: St.Icon;
    private _items = new Map<number, PopupMenu.PopupMenuItem>();

    constructor({ ddc, title, iconName, code, presets, onChanged }: PresetToggleParams) {
        super({ title, iconName, toggleMode: false });
        this._ddc = ddc;
        this._code = code;
        this._presets = presets;
        this._onChanged = onChanged;
        // The tile's clickable body is an inner button that ignores the outer `reactive`, and
        // the theme's insensitive style never reaches the arrow, so both are handled by hand.
        const box = this.get_child() as St.BoxLayout;
        this._body = box.get_first_child() as St.Button;
        this._arrow = (box.get_last_child() as St.Button).get_child() as St.Icon;
        this.connect('clicked', () => this.menu.open());
        this.menu.setHeader(iconName, title);

        for (const [value, name] of presets) {
            const item = new PopupMenu.PopupMenuItem(name);
            item.connect('activate', () => this._select(value));
            this.menu.addMenuItem(item);
            this._items.set(value, item);
        }
    }

    setPreset(value: number, available: boolean) {
        for (const [preset, item] of this._items)
            item.setOrnament(preset === value ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE);
        this.reactive = this._body.reactive = this.checked = available;
        this._arrow.opacity = available ? 255 : 128;
        if (!available) this.menu.close();
        this.subtitle = this._presets.find(([preset]) => preset === value)?.[1] ?? null;
    }

    private async _select(value: number) {
        try {
            await this._ddc.set(this._code, value);
            this.setPreset(value, true);
        } catch (e) {
            logError(e);
        }
        this._onChanged();
    }
}

class HdrPresetToggle extends PresetToggle {
    static {
        GObject.registerClass(HdrPresetToggle);
    }

    private _flags = 0;
    private _boostSeparator: PopupMenu.PopupSeparatorMenuItem;
    private _boost: PopupMenu.PopupSwitchMenuItem;

    constructor(params: PresetToggleParams) {
        super(params);
        this._boostSeparator = new PopupMenu.PopupSeparatorMenuItem();
        this._boost = new PopupMenu.PopupSwitchMenuItem(_('Dynamic Brightness Boost'), false);
        this._boost.connect('toggled', (_item: unknown, on: boolean) => this._setBoost(on));
        this.menu.addMenuItem(this._boostSeparator);
        this.menu.addMenuItem(this._boost);
    }

    setFlags(preset: number, flags: number | null) {
        this._flags = flags ?? 0;
        const shown = preset === CONSOLE_HDR && flags !== null;
        this._boostSeparator.visible = this._boost.visible = shown;
        this._boost.setToggleState(Boolean(this._flags & HDR_FLAG_BOOST));
    }

    private async _setBoost(on: boolean) {
        const flags = on ? this._flags | HDR_FLAG_BOOST : this._flags & ~HDR_FLAG_BOOST;
        try {
            await this._ddc.set(VCP.HDR_FLAGS, flags);
            this._flags = flags;
        } catch (e) {
            logError(e);
            this._boost.setToggleState(!on);
        }
    }
}

class HdrToggle extends QuickToggle {
    static {
        GObject.registerClass(HdrToggle);
    }

    private _ddc: Ddc;
    private _onChanged: () => void;

    constructor(ddc: Ddc, onChanged: () => void) {
        super({ title: _('HDR'), iconName: 'video-display-symbolic', toggleMode: false });
        this._ddc = ddc;
        this._onChanged = onChanged;
        this.connect('clicked', () => this.toggle());
    }

    async toggle() {
        const connector = this._ddc.connector;
        if (!this.visible || !connector) return;
        await DisplayConfig.setHdr(connector, !this.checked).catch(logError);
        this._onChanged();
    }
}

class ItemIndicator extends SystemIndicator {
    static {
        GObject.registerClass(ItemIndicator);
    }

    constructor(...items: QuickSettingsItem[]) {
        super();
        this.quickSettingsItems.push(...items);
    }

    override destroy() {
        for (const item of this.quickSettingsItems) item.destroy();
        super.destroy();
    }
}

export default class Pg32ucdm3ControlsExtension extends Extension {
    private _ddc: Ddc | null = null;
    private _settleId = 0;
    private _menuId = 0;
    private _monitorsId = 0;
    private _settings: Gio.Settings | null = null;
    private _keysId = 0;
    private _keysTaken = false;
    private _slider: BrightnessSlider | null = null;
    private _hdr: HdrToggle | null = null;
    private _hdrPresets: HdrPresetToggle | null = null;
    private _modes: PresetToggle | null = null;
    private _indicators: ItemIndicator[] = [];

    override enable() {
        const ddc = new Ddc();
        this._ddc = ddc;
        this._slider = new BrightnessSlider(ddc);
        this._hdr = new HdrToggle(ddc, () => this._syncSoon());
        // Changing the HDR preset makes the monitor drop off the link for a few seconds.
        this._hdrPresets = new HdrPresetToggle({
            ddc,
            title: _('HDR Preset'),
            iconName: 'preferences-desktop-display-symbolic',
            code: VCP.HDR_PRESET,
            presets: HDR_PRESETS,
            onChanged: () => this._syncSoon(),
        });
        // Each GameVisual mode keeps its own brightness, so a switch must re-read the slider.
        this._modes = new PresetToggle({
            ddc,
            title: _('GameVisual'),
            iconName: 'preferences-color-symbolic',
            code: VCP.GAMEVISUAL,
            presets: GAMEVISUAL_MODES,
            onChanged: () => this._sync(),
        });

        const quickSettings = Main.panel.statusArea.quickSettings;
        if (!quickSettings) throw new Error('Quick Settings is not available');
        const sliderIndicator = new ItemIndicator(this._slider);
        const togglesIndicator = new ItemIndicator(this._hdr, this._hdrPresets, this._modes);
        quickSettings.addExternalIndicator(sliderIndicator, 2);
        quickSettings.addExternalIndicator(togglesIndicator);
        this._indicators = [sliderIndicator, togglesIndicator];

        // The monitor's own buttons can change anything, so re-read whenever Quick Settings opens.
        this._menuId = quickSettings.menu.connect(
            'open-state-changed',
            (_menu: unknown, open: boolean) => {
                if (open) this._sync();
            },
        );
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._syncSoon());

        this._settings = this.getSettings();
        this._keysId = this._settings.connect('changed::brightness-keys', () =>
            this._updateBrightnessKeys(),
        );
        this._updateBrightnessKeys();
        Main.wm.addKeybinding(
            'toggle-hdr',
            this._settings,
            Meta.KeyBindingFlags.NONE,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._hdr?.toggle(),
        );

        this._sync();
    }

    override disable() {
        Main.wm.removeKeybinding('toggle-hdr');
        this._settings?.disconnect(this._keysId);
        this._settings = null;
        this._updateBrightnessKeys();
        if (this._settleId) GLib.source_remove(this._settleId);
        this._settleId = 0;
        Main.panel.statusArea.quickSettings?.menu.disconnect(this._menuId);
        Main.layoutManager.disconnect(this._monitorsId);
        for (const indicator of this._indicators) indicator.destroy();
        this._indicators = [];
        this._slider = this._hdr = this._hdrPresets = this._modes = null;
        this._ddc = null;
    }

    // Takes GNOME's brightness keys while the setting is on (and the extension enabled), and
    // hands them back to GNOME's own handlers otherwise.
    private _updateBrightnessKeys() {
        const take = this._settings?.get_boolean('brightness-keys') ?? false;
        if (take === this._keysTaken) return;
        this._keysTaken = take;
        this._bindBrightnessKeys(take ? (d) => this._brightnessKey(d) : builtinBrightnessKey);
    }

    private _bindBrightnessKeys(handler: (direction: number) => void) {
        const keybindings = new Gio.Settings({ schema_id: 'org.gnome.shell.keybindings' });
        const keys = [
            ['screen-brightness-up', 1],
            ['screen-brightness-down', -1],
        ] as const;
        for (const [name, direction] of keys) {
            Main.wm.removeKeybinding(name);
            Main.wm.addKeybinding(
                name,
                keybindings,
                Meta.KeyBindingFlags.NONE,
                Shell.ActionMode.ALL,
                () => handler(direction),
            );
        }
    }

    // The keys follow the pointer, and drive this monitor when there is no built-in panel to drive.
    private _brightnessKey(direction: number) {
        const slider = this._slider;
        const onMonitor =
            slider?.visible &&
            (!brightnessManager().globalScale ||
                global.display.get_current_monitor() ===
                    monitorIndex(this._ddc?.connector ?? null));
        if (onMonitor) slider.step(direction);
        else builtinBrightnessKey(direction);
    }

    // A reading taken while the display is still reconfiguring can be stale, so read again once it settles.
    private _syncSoon() {
        if (!this._ddc) return;
        this._sync();
        if (this._settleId) GLib.source_remove(this._settleId);
        this._settleId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, SETTLE_SECONDS, () => {
            this._settleId = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    private async _sync() {
        const ddc = this._ddc;
        if (!ddc) return;
        const monitor = await DisplayConfig.findMonitor(PRODUCT).catch(logError);
        // Async work can outlive disable(), or straddle a disable/enable cycle.
        if (ddc !== this._ddc) return;
        ddc.connector = monitor?.connector ?? null;
        const state = ddc.connector ? await ddc.readState().catch(logError) : null;
        const { _slider: slider, _hdr: hdr, _hdrPresets: hdrPresets, _modes: modes } = this;
        if (ddc !== this._ddc || !slider || !hdr || !hdrPresets || !modes) return;

        const hdrOn = monitor?.hdrEnabled ?? false;
        hdr.visible = Boolean(monitor?.active && monitor.hdrSupported);
        hdr.checked = hdrOn;

        slider.visible = state?.brightness != null;
        if (state?.brightness != null) slider.setValue(state.brightness);
        slider.setLocked(hdrOn);

        // GameVisual stays visible but locked in HDR, where the monitor ignores it.
        modes.visible = state?.mode != null;
        if (state?.mode != null) modes.setPreset(state.mode, !hdrOn);

        // Outside HDR the preset reads 0, so there is nothing to show.
        hdrPresets.visible = hdrOn && Boolean(state?.hdrPreset);
        if (state?.hdrPreset && hdrPresets.visible) {
            hdrPresets.setPreset(state.hdrPreset, true);
            hdrPresets.setFlags(state.hdrPreset, state.hdrFlags);
        }
    }
}
