// SPDX-License-Identifier: GPL-2.0-or-later

// Everything here was mapped on a PG32UCDM3 by changing a setting on the monitor's own menu
// and diffing every VCP code before and after; E2 and 5F are not in the MCCS standard.

export type Preset = readonly [value: number, name: string];

export const PRODUCT = 'PG32UCDM3';

export const VCP = {
    BRIGHTNESS: '10',
    GAMEVISUAL: 'DC',
    HDR_PRESET: 'E2',
    HDR_FLAGS: '5F',
} as const;

export type VcpCode = (typeof VCP)[keyof typeof VCP];

export const GAMEVISUAL_MODES: readonly Preset[] = [
    [0x01, 'Cinema'],
    [0x02, 'Scenery'],
    [0x04, 'User'],
    [0x05, 'Racing'],
    [0x06, 'RTS/RPG'],
    [0x07, 'FPS'],
    [0x08, 'MOBA'],
    [0x09, 'Night Vision'],
    [0x0a, 'sRGB Cal'],
];

export const HDR_PRESETS: readonly Preset[] = [
    [0x01, 'Cinema HDR'],
    [0x02, 'Gaming HDR'],
    [0x03, 'Console HDR'],
    [0x08, 'DisplayHDR 500 True Black'],
];

// Per the manual, Gaming and Cinema HDR have the boost built in and True Black never uses it,
// so its switch only matters in Console HDR.
export const CONSOLE_HDR = 0x03;

// Bits of HDR_FLAGS; 0x01 is Adjustable HDR, which is deliberately left alone.
export const HDR_FLAG_BOOST = 0x04;
