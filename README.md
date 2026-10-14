# PG32UCDM3 Controls

A GNOME Shell extension that puts the ASUS ROG Swift OLED **PG32UCDM3** monitor's main
settings in Quick Settings, using DDC/CI through [ddcutil](https://www.ddcutil.com/).

Not affiliated with or endorsed by ASUS. Several of the settings it uses are undocumented
and were mapped by hand on one monitor; see [How the values were found](#how-the-values-were-found).

## Features

- **Brightness slider** for the monitor, with GNOME's brightness pop-up shown on it.
- **GameVisual** mode menu: Cinema, Scenery, User, Racing, RTS/RPG, FPS, MOBA, Night Vision,
  sRGB Cal.
- **HDR** toggle that changes only this monitor's color mode and keeps the rest of your
  layout, including other screens.
- **HDR preset** menu, shown while HDR is on: Cinema HDR, Gaming HDR, Console HDR and
  DisplayHDR 500 True Black.
- **Dynamic Brightness Boost** switch, shown in Console HDR (the only preset where the
  monitor lets you change it).
- **Brightness keys follow the pointer**: they adjust this monitor when the pointer is on it
  or there is no built-in panel, and the laptop panel otherwise. On by default; can be turned
  off in the preferences.
- <kbd>Super</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> toggles HDR.

Controls hide while the monitor is unplugged, and the monitor is found by its model name,
not by port, so another monitor on the same port is never driven.

## Requirements

- GNOME Shell 50 (developed on Wayland).
- ddcutil 2.0 or later (developed with 3.0.1), able to reach the monitor **without root**.
  Most distribution packages install a udev rule for this; on some you also need to be in
  the `i2c` group. `ddcutil detect` should list the PG32UCDM3.
- **DDC/CI enabled** on the monitor: *System Setup → DDC/CI*. The monitor only lets you change
  that option while VRR is off.

## Installation

Building needs Node.js 22 or later, [pnpm](https://pnpm.io/) (`corepack enable` provides the
version this project pins), and `gnome-extensions`, which ships with GNOME Shell.

```sh
git clone https://github.com/leonardo-ornelas/pg32ucdm3-controls.git
cd pg32ucdm3-controls
pnpm install --frozen-lockfile
make install
```

Log out and back in (GNOME on Wayland only loads new extensions at login), then:

```sh
gnome-extensions enable pg32ucdm3-controls@leonardo-ornelas.github.io
```

To remove it: `make uninstall`.

## Things to know

- **The HDR toggle saves the setting**, as GNOME Settings does: HDR stays on across reboots and
  reconnects until you turn it off.
- **Changing the HDR preset makes the monitor drop off for a few seconds** while it re-links.
  The extension re-reads its state once it is back.
- **In HDR the monitor ignores brightness and GameVisual changes.** The slider shows the HDR
  brightness but cannot change it, and GameVisual is greyed out.
- **The brightness keys are taken over from GNOME** so they can follow the pointer. GNOME allows
  one handler per shortcut, so another extension that also uses the brightness keys will
  conflict; turn off *Brightness keys control this monitor* in the extension's preferences and
  the keys go back to GNOME's own handler.
- To change the HDR shortcut (the preferences window shows it):

  ```sh
  gsettings --schemadir ~/.local/share/gnome-shell/extensions/pg32ucdm3-controls@leonardo-ornelas.github.io/schemas \
    set org.gnome.shell.extensions.pg32ucdm3-controls toggle-hdr "['<Super><Alt>h']"
  ```

Not available over DDC/CI, so not in the extension: Display Color Space, and changing
brightness while in HDR.

## How the values were found

Each setting was changed on the monitor's own menu while every VCP code (`0x02`–`0xFF`) was read
before and after; the code whose value changed is the setting. Writes were then confirmed on the
monitor's menu.

| VCP | Setting | Values |
|---|---|---|
| `10` | Brightness | 0–100. In HDR it reads 100, or the HDR brightness if *Adjustable HDR* is on; writes are rejected. |
| `DC` | GameVisual | `01` Cinema, `02` Scenery, `04` User, `05` Racing, `06` RTS/RPG, `07` FPS, `08` MOBA, `09` Night Vision, `0A` sRGB Cal |
| `E2` | HDR preset (undocumented) | Low byte: `01` Cinema HDR, `02` Gaming HDR, `03` Console HDR, `08` DisplayHDR 500 True Black. Reads 0 outside HDR. |
| `5F` | HDR switches (undocumented) | Bit `0x01` Adjustable HDR, bit `0x04` Dynamic Brightness Boost |

ddcutil 3.0.1 quirks this extension works around:

- Values are passed in hex (`0x08`): a leading zero is read as octal, so `08` is rejected.
- `--mccs 2.2` is needed, or reading some codes aborts on an assertion.
- `--permit-unknown-feature` is needed to write `5F`.

If you have a PG32UCDM3 on different firmware, or a sibling model, reports of what matches and
what does not are welcome as issues.

## Troubleshooting

Errors are logged to the journal:

```sh
journalctl -f -o cat /usr/bin/gnome-shell | grep 'PG32UCDM3 controls'
```

If the controls never appear, check that `ddcutil detect` lists the monitor as your user.

## Development

The extension is written in TypeScript and compiled to the JavaScript GNOME Shell loads.
Types come from [`@girs/gnome-shell`](https://www.npmjs.com/package/@girs/gnome-shell);
linting and formatting are done with [Biome](https://biomejs.dev/).

```sh
pnpm install
make check     # Biome, type-check, GSettings schema validation
pnpm format   # apply Biome formatting
make install   # build, pack and install; then log out and back in
```

Sources are in `src/`; `make` compiles them into `build/` and packs `dist/*.zip`.

## License

[GPL-2.0-or-later](LICENSE), the same license as GNOME Shell.
