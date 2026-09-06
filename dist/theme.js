/**
 * theme.ts — Centralized terminal styling, color system, and Brain + Terminal visual identity.
 *
 * Provides:
 *  - Full terminal color support detection (respects --no-color, NO_COLOR, TTY)
 *  - Semantic styling helpers: brand(), success(), warning(), error(), muted(), highlight(), heading(), label()
 *  - Brain + Terminal visual identity ASCII/Unicode logos
 *  - Formatted layout builders: card(), banner(), statusBadge(), table()
 */
// ─── Color Support & State ───────────────────────────────────────────────────
let explicitColorOverride = null;
export function setColorEnabled(enabled) {
    explicitColorOverride = enabled;
}
export function isColorSupported() {
    if (explicitColorOverride !== null) {
        return explicitColorOverride;
    }
    // Check command line arguments for --no-color
    if (typeof process !== 'undefined' && process.argv) {
        if (process.argv.includes('--no-color'))
            return false;
        if (process.argv.includes('--color'))
            return true;
    }
    // Check standard environment variables
    if (typeof process !== 'undefined' && process.env) {
        if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== '')
            return false;
        if (process.env.NODE_DISABLE_COLORS === '1')
            return false;
        if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0')
            return true;
        if (process.env.TERM === 'dumb')
            return false;
    }
    // Check if stdout is an interactive terminal
    if (typeof process !== 'undefined' && process.stdout) {
        return Boolean(process.stdout.isTTY);
    }
    return false;
}
// ─── ANSI Code Utilities ─────────────────────────────────────────────────────
const ESC = '\x1b[';
const RESET = `${ESC}0m`;
function wrap(open, close = RESET) {
    return (text) => {
        if (!isColorSupported() || text === undefined || text === null)
            return String(text ?? '');
        return `${open}${text}${close}`;
    };
}
// ─── Semantic Styles ─────────────────────────────────────────────────────────
export const bold = wrap(`${ESC}1m`);
export const dim = wrap(`${ESC}2m`);
export const italic = wrap(`${ESC}3m`);
export const underline = wrap(`${ESC}4m`);
// Standard colors
export const red = wrap(`${ESC}31m`);
export const green = wrap(`${ESC}32m`);
export const yellow = wrap(`${ESC}33m`);
export const blue = wrap(`${ESC}34m`);
export const magenta = wrap(`${ESC}35m`);
export const cyan = wrap(`${ESC}36m`);
export const white = wrap(`${ESC}37m`);
export const gray = wrap(`${ESC}90m`);
export const brightCyan = wrap(`${ESC}96m`);
export const brightWhite = wrap(`${ESC}97m`);
// TrueColor RGB styling
export function rgb(r, g, b, text) {
    const str = String(text);
    if (!isColorSupported() || !str)
        return str;
    return `${ESC}38;2;${Math.round(r)};${Math.round(g)};${Math.round(b)}m${str}${RESET}`;
}
const BRAND_STOPS = [
    { r: 168, g: 85, b: 247 }, // #A855F7 Purple
    { r: 59, g: 130, b: 246 }, // #3B82F6 Blue
    { r: 6, g: 182, b: 212 }, // #06B6D4 Cyan
];
function interpolateRgb(c1, c2, factor) {
    return {
        r: c1.r + (c2.r - c1.r) * factor,
        g: c1.g + (c2.g - c1.g) * factor,
        b: c1.b + (c2.b - c1.b) * factor,
    };
}
function getGradientColor(fraction, stops = BRAND_STOPS) {
    const t = Math.max(0, Math.min(1, fraction));
    const segment = t * (stops.length - 1);
    const idx = Math.min(Math.floor(segment), stops.length - 2);
    const localFactor = segment - idx;
    return interpolateRgb(stops[idx], stops[idx + 1], localFactor);
}
/**
 * Applies a smooth multi-stop gradient across a text string.
 */
export function gradient(text, stops = BRAND_STOPS) {
    const str = String(text);
    if (!isColorSupported() || !str)
        return str;
    // Strip ANSI sequences when computing string length to avoid distortion
    const clean = str.replace(/\x1b\[[0-9;]*m/g, '');
    if (clean.length === 0)
        return str;
    let result = '';
    let cleanIndex = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        // Check if inside ANSI escape sequence
        if (char === '\x1b') {
            const end = str.indexOf('m', i);
            if (end !== -1) {
                result += str.slice(i, end + 1);
                i = end;
                continue;
            }
        }
        const fraction = clean.length > 1 ? cleanIndex / (clean.length - 1) : 0;
        const c = getGradientColor(fraction, stops);
        result += rgb(c.r, c.g, c.b, char);
        cleanIndex++;
    }
    return result;
}
// ─── Semantic Helper Functions ───────────────────────────────────────────────
export function brand(text) {
    return gradient(text);
}
export function success(text) {
    return green(text);
}
export function warning(text) {
    return yellow(text);
}
export function error(text) {
    return red(text);
}
export function muted(text) {
    return gray(text);
}
export function highlight(text) {
    const str = String(text);
    if (!isColorSupported())
        return str;
    return `${ESC}1m${ESC}97m${str}${RESET}`;
}
export function heading(text) {
    const str = String(text);
    if (!isColorSupported())
        return str;
    return `${ESC}1m${ESC}96m${str}${RESET}`;
}
export function label(name, width = 14) {
    const padded = name.padEnd(width);
    return isColorSupported() ? `${ESC}90m${padded}${RESET}` : padded;
}
export function keyVal(name, val, labelWidth = 14) {
    return `${label(name, labelWidth)} ${highlight(String(val))}`;
}
// ─── Status & Badges ─────────────────────────────────────────────────────────
export function statusDot(status) {
    const s = (status || '').toLowerCase();
    if (s === 'active') {
        return isColorSupported() ? `${green('●')} ${green('ACTIVE')}` : '● ACTIVE';
    }
    if (s === 'stale') {
        return isColorSupported() ? `${yellow('●')} ${yellow('STALE')}` : '● STALE';
    }
    if (s === 'deprecated') {
        return isColorSupported() ? `${gray('○')} ${gray('DEPRECATED')}` : '○ DEPRECATED';
    }
    if (s === 'idle') {
        return isColorSupported() ? `${gray('○')} ${gray('idle')}` : '○ idle';
    }
    return isColorSupported() ? `${cyan('●')} ${status.toUpperCase()}` : `● ${status.toUpperCase()}`;
}
export function badge(text, type = 'brand') {
    if (!isColorSupported())
        return `[${text}]`;
    switch (type) {
        case 'brand': return `${ESC}38;2;168;85;247m[${RESET}${cyan(text)}${ESC}38;2;168;85;247m]${RESET}`;
        case 'success': return `${green('[')}${brightWhite(text)}${green(']')}`;
        case 'warning': return `${yellow('[')}${brightWhite(text)}${yellow(']')}`;
        case 'error': return `${red('[')}${brightWhite(text)}${red(']')}`;
        case 'muted': return `${gray('[')}${dim(text)}${gray(']')}`;
    }
}
// ─── Brain + Terminal Visual Identity ────────────────────────────────────────
/**
 * Returns the compact Brain + Terminal mark.
 */
export function compactMark() {
    if (!isColorSupported())
        return '◈>';
    return `${ESC}38;2;168;85;247m◈${ESC}38;2;6;182;212m>${RESET}`;
}
/**
 * Returns the Brain + Terminal ASCII artwork.
 * Left side represents neural/synapse connections; right side represents terminal `>_`.
 */
export function brainAsciiArt() {
    return [
        '   ╭──────╮   ',
        ' ╭─╯ ╷  ╷ ╰─╮ ',
        ' │ ●─┼──┼─ >_ ',
        ' ╰─╮ ╵  ╵ ╭─╯ ',
        '   ╰──────╯   ',
    ];
}
/**
 * Strips ANSI color codes for accurate width calculation.
 */
export function stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}
/**
 * Centers text within a given width, taking ANSI escape codes into account.
 */
export function centerText(text, width) {
    const visibleLen = stripAnsi(text).length;
    if (visibleLen >= width)
        return text;
    const leftPad = Math.floor((width - visibleLen) / 2);
    const rightPad = width - visibleLen - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
}
/**
 * Creates a rounded, framed terminal card with the given lines.
 */
export function card(lines, innerWidth = 52) {
    const topBorder = `╭${'─'.repeat(innerWidth)}╮`;
    const bottomBorder = `╰${'─'.repeat(innerWidth)}╯`;
    const emptyLine = `│${' '.repeat(innerWidth)}│`;
    const border = isColorSupported() ? gray : (s) => s;
    const formattedLines = lines.map(line => {
        const visibleLen = stripAnsi(line).length;
        const padding = Math.max(0, innerWidth - visibleLen);
        return `${border('│')}${line}${' '.repeat(padding)}${border('│')}`;
    });
    return [
        border(topBorder),
        border(emptyLine),
        ...formattedLines,
        border(emptyLine),
        border(bottomBorder),
    ].join('\n');
}
/**
 * Builds the hero banner card with Brain + Terminal logo, title, and subtitle.
 */
export function headerBanner() {
    const innerWidth = 52;
    const art = brainAsciiArt().map(l => gradient(l));
    const title = isColorSupported()
        ? `${ESC}1m${brightWhite('Local Brain MCP')}${RESET}`
        : 'Local Brain MCP';
    const subtitle = isColorSupported()
        ? `${ESC}90mShared Memory for AI Coding Agents${RESET}`
        : 'Shared Memory for AI Coding Agents';
    const lines = [
        ...art.map(l => centerText(l, innerWidth)),
        centerText('', innerWidth),
        centerText(title, innerWidth),
        centerText(subtitle, innerWidth),
    ];
    return card(lines, innerWidth);
}
//# sourceMappingURL=theme.js.map