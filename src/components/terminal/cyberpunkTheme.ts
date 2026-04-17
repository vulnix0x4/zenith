import type { ITheme } from '@xterm/xterm';

/**
 * Cyberpunk-inspired palette tuned for high contrast and visual punch.
 *
 * Design notes:
 * - The default foreground gets a faint cyan tint instead of flat grey, so
 *   uncoloured text (like Ubuntu's MOTD) reads as "themed" rather than stark
 *   white. Still desaturated enough to be comfortable for long sessions.
 * - The 16 ANSI colours lean saturated -- comparable to Tomorrow Night /
 *   MobaXterm defaults -- so coloured `ls`, `git`, `tree` etc. pop.
 * - Bright variants are brighter rather than just paler, giving bold output
 *   real visual weight.
 */
export const cyberpunkTheme: ITheme = {
  foreground: '#cfe6e0',
  background: '#0a0a0f',
  cursor: '#00ffc8',
  cursorAccent: '#0a0a0f',
  selectionBackground: '#00ffc855',
  selectionForeground: '#0a0a0f',
  selectionInactiveBackground: '#00ffc822',

  // Standard ANSI 0-7
  black: '#1a1a2e',
  red: '#ff5f87',
  green: '#5af78e',
  yellow: '#f3f99d',
  blue: '#57c7ff',
  magenta: '#ff6ac1',
  cyan: '#9aedfe',
  white: '#cfe6e0',

  // Bright ANSI 8-15 -- noticeably brighter, not just lighter
  brightBlack: '#686888',
  brightRed: '#ff8fba',
  brightGreen: '#7dffaa',
  brightYellow: '#ffe066',
  brightBlue: '#7aa2ff',
  brightMagenta: '#d4a0ff',
  brightCyan: '#a8f0ff',
  brightWhite: '#ffffff',
};
