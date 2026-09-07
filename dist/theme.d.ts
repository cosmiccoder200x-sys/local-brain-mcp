/**
 * theme.ts — Centralized terminal styling, color system, and Brain + Terminal visual identity.
 *
 * Provides:
 *  - Full terminal color support detection (respects --no-color, NO_COLOR, TTY)
 *  - Semantic styling helpers: brand(), success(), warning(), error(), muted(), highlight(), heading(), label()
 *  - Brain + Terminal visual identity ASCII/Unicode logos
 *  - Formatted layout builders: card(), banner(), statusBadge(), table()
 */
export declare function setColorEnabled(enabled: boolean): void;
export declare function isColorSupported(): boolean;
export declare const bold: (text: string | number) => string;
export declare const dim: (text: string | number) => string;
export declare const italic: (text: string | number) => string;
export declare const underline: (text: string | number) => string;
export declare const red: (text: string | number) => string;
export declare const green: (text: string | number) => string;
export declare const yellow: (text: string | number) => string;
export declare const blue: (text: string | number) => string;
export declare const magenta: (text: string | number) => string;
export declare const cyan: (text: string | number) => string;
export declare const white: (text: string | number) => string;
export declare const gray: (text: string | number) => string;
export declare const brightCyan: (text: string | number) => string;
export declare const brightWhite: (text: string | number) => string;
export declare function rgb(r: number, g: number, b: number, text: string | number): string;
interface RgbColor {
    r: number;
    g: number;
    b: number;
}
/**
 * Applies a smooth multi-stop gradient across a text string.
 */
export declare function gradient(text: string | number, stops?: RgbColor[]): string;
export declare function brand(text: string | number): string;
export declare function success(text: string | number): string;
export declare function warning(text: string | number): string;
export declare function error(text: string | number): string;
export declare function muted(text: string | number): string;
export declare function highlight(text: string | number): string;
export declare function heading(text: string | number): string;
export declare function label(name: string, width?: number): string;
export declare function keyVal(name: string, val: string | number, labelWidth?: number): string;
export declare function statusDot(status: string): string;
export declare function badge(text: string, type?: "brand" | "success" | "warning" | "error" | "muted"): string;
/**
 * Returns the compact Brain + Terminal mark.
 */
export declare function compactMark(): string;
/**
 * Returns the app-tile ASCII artwork matching the brand mark.
 * A dark rounded tile containing the centered terminal `>_` prompt
 * with synapse nodes (`●`) on its circuit traces.
 */
export declare function brainAsciiArt(): string[];
/**
 * Strips ANSI color codes for accurate width calculation.
 */
export declare function stripAnsi(str: string): string;
/**
 * Centers text within a given width, taking ANSI escape codes into account.
 */
export declare function centerText(text: string, width: number): string;
/**
 * Creates a rounded, framed terminal card with the given lines.
 */
export declare function card(lines: string[], innerWidth?: number): string;
/**
 * Builds the hero banner card with Brain + Terminal logo, title, and subtitle.
 */
export declare function headerBanner(): string;
export {};
//# sourceMappingURL=theme.d.ts.map