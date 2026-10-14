// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { VCP, type VcpCode } from './model.js';

const TIMEOUT_SECONDS = 10;

export interface MonitorState {
    brightness: number | null;
    mode: number | null;
    hdrPreset: number | null;
    hdrFlags: number | null;
}

function run(argv: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = Gio.Subprocess.new(
            argv,
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        );
        // A wedged I2C bus can hang ddcutil, and every later call queues behind it.
        let timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, TIMEOUT_SECONDS, () => {
            timeoutId = 0;
            proc.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        proc.communicate_utf8_async(null, null, (_proc, res) => {
            if (timeoutId) GLib.source_remove(timeoutId);
            try {
                const [, out, err] = proc.communicate_utf8_finish(res);
                if (proc.get_successful()) resolve(out ?? '');
                else reject(new Error(`${argv.join(' ')}: ${err?.trim() || 'killed'}`));
            } catch (e) {
                reject(e);
            }
        });
    });
}

// The I2C bus number can change across boots and docks, so resolve it from the connector.
function findBus(connector: string): string | null {
    const dir = GLib.Dir.open('/sys/class/drm', 0);
    let bus: string | null = null;
    for (let name = dir.read_name(); name !== null && !bus; name = dir.read_name()) {
        const ddcLink = `/sys/class/drm/${name}/ddc`;
        if (name.endsWith(`-${connector}`) && GLib.file_test(ddcLink, GLib.FileTest.IS_SYMLINK))
            bus = /i2c-(\d+)$/.exec(GLib.file_read_link(ddcLink))?.[1] ?? null;
    }
    dir.close();
    return bus;
}

function lastByte(out: string, code: VcpCode): number | null {
    const match = new RegExp(`^VCP ${code} \\w+(?: x\\w+)* x([0-9a-f]+)\\s*$`, 'mi').exec(out);
    return match ? Number.parseInt(match[1], 16) : null;
}

export class Ddc {
    connector: string | null = null;
    #queue: Promise<unknown> = Promise.resolve();

    // Two ddcutil calls on the same bus at once make one of them fail, so every call waits its turn.
    #call(args: string[]): Promise<string> {
        const call = this.#queue.then(() => {
            const bus = this.connector && findBus(this.connector);
            if (!bus) throw new Error(`no DDC bus for ${this.connector ?? 'the monitor'}`);
            // ddcutil 3.0.1 aborts on some of this monitor's codes without an explicit MCCS
            // version, and refuses to write the undocumented ones unless told to.
            return run([
                'ddcutil',
                '--bus',
                bus,
                '--mccs',
                '2.2',
                '--permit-unknown-feature',
                ...args,
            ]);
        });
        this.#queue = call.catch(() => {});
        return call;
    }

    async readState(): Promise<MonitorState> {
        const out = await this.#call([
            '-t',
            'getvcp',
            VCP.BRIGHTNESS,
            VCP.GAMEVISUAL,
            VCP.HDR_PRESET,
            VCP.HDR_FLAGS,
        ]);
        const brightness = new RegExp(`^VCP ${VCP.BRIGHTNESS} C (\\d+) (\\d+)\\s*$`, 'm').exec(out);
        return {
            brightness: brightness ? Number(brightness[1]) / Number(brightness[2]) : null,
            mode: lastByte(out, VCP.GAMEVISUAL),
            hdrPreset: lastByte(out, VCP.HDR_PRESET),
            hdrFlags: lastByte(out, VCP.HDR_FLAGS),
        };
    }

    // Values go out in hex: ddcutil reads a leading zero as octal, so "08" would be rejected.
    async set(code: VcpCode, value: number): Promise<void> {
        await this.#call(['--noverify', 'setvcp', code, `0x${value.toString(16)}`]);
    }
}
