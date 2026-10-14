// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {
    gettext as _,
    ExtensionPreferences,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Pg32ucdm3ControlsPreferences extends ExtensionPreferences {
    override async fillPreferencesWindow(window: Adw.PreferencesWindow) {
        const settings = this.getSettings();

        const keysRow = new Adw.SwitchRow({
            title: _('Brightness keys control this monitor'),
            subtitle: _(
                'When the pointer is on it, or there is no built-in screen. Turn off if another extension also uses the brightness keys.',
            ),
        });
        settings.bind('brightness-keys', keysRow, 'active', Gio.SettingsBindFlags.DEFAULT);

        const hdrShortcut = new Adw.ShortcutLabel({ valign: Gtk.Align.CENTER });
        const showHdrShortcut = () => {
            hdrShortcut.accelerator = settings.get_strv('toggle-hdr')[0] ?? '';
        };
        showHdrShortcut();
        settings.connect('changed::toggle-hdr', showHdrShortcut);
        const hdrRow = new Adw.ActionRow({ title: _('Toggle HDR') });
        hdrRow.add_suffix(hdrShortcut);

        const group = new Adw.PreferencesGroup({ title: _('Keyboard') });
        group.add(keysRow);
        group.add(hdrRow);
        const page = new Adw.PreferencesPage();
        page.add(group);
        window.add(page);
    }
}
