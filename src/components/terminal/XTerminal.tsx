import { useEffect, useRef, type MutableRefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { cyberpunkTheme } from './cyberpunkTheme';
import styles from './XTerminal.module.css';

interface XTerminalProps {
  onData: (data: string) => void;
  onResize: (cols: number, rows: number) => void;
  /** Fired when the shell emits an OSC 7 sequence reporting its working dir. */
  onCwdChange?: (cwd: string) => void;
  terminalRef?: MutableRefObject<Terminal | null>;
}

export default function XTerminal({ onData, onResize, onCwdChange, terminalRef }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace",
      lineHeight: 1.4,
      scrollback: 10000,
      theme: cyberpunkTheme,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);

    terminal.open(container);

    // Try loading WebGL addon with fallback to canvas
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, fall back to canvas renderer
    }

    // Guarded fit: skip when the container has no layout (e.g. this leaf
    // lives under an inactive tab whose wrapper is display:none, or it's
    // parked in the off-screen "limbo" host mid-transition). Calling
    // fitAddon.fit() on a 0-sized container collapses the terminal to 1 col
    // and stays that way even after the tab is shown again.
    const safeFit = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      try {
        fitAddon.fit();
      } catch {
        // Fit can throw transiently during re-parenting
      }
    };

    // Fit after open (guarded)
    safeFit();

    // Large-paste guard. Pasting a multi-megabyte blob or a script with
    // dozens of lines into a remote shell commonly ends in tears -- the
    // shell interprets each newline as a command and the user can't
    // interrupt mid-stream. Intercept term.paste and prompt for confirmation
    // above generous thresholds. (Our own Ctrl+V handler below also routes
    // through this, as does xterm's native bracketed-paste handling.)
    const origPaste = terminal.paste.bind(terminal);
    terminal.paste = (data: string) => {
      const newlineCount = (data.match(/\n/g) || []).length;
      if (data.length > 5000 || newlineCount > 10) {
        const ok = window.confirm(
          `Paste ${data.length} characters / ${newlineCount} lines? ` +
            `This may overwhelm the remote shell.`
        );
        if (!ok) return;
      }
      origPaste(data);
    };

    // Store ref
    termRef.current = terminal;
    if (terminalRef) {
      terminalRef.current = terminal;
    }

    // Data handler: forward user keystrokes
    const dataDisposable = terminal.onData(onData);

    // Resize handler: report new dimensions
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      onResize(cols, rows);
    });

    // OSC 7 (working directory). Shells emit:
    //   ESC ] 7 ; file://<host>/<path> ESC \
    // We get just the payload "file://host/path". Decode and forward the path.
    // Returns true to mark the OSC as handled so xterm doesn't pass it on.
    const oscDisposable = terminal.parser.registerOscHandler(7, (payload) => {
      try {
        // file://host/path -- pull the pathname and percent-decode it
        const url = new URL(payload);
        const decoded = decodeURIComponent(url.pathname);
        if (decoded && onCwdChange) {
          onCwdChange(decoded);
        }
      } catch {
        // Bad payload -- swallow silently
      }
      return true;
    });

    // Select-to-copy: copy selection to clipboard on selection change
    const selectionDisposable = terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {
          // Clipboard write failed silently
        });
      }
    });

    // Custom key handler: Cmd/Ctrl+C copies when text is selected, otherwise sends SIGINT
    // Cmd/Ctrl+V pastes from clipboard
    terminal.attachCustomKeyEventHandler((event) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (event.type !== 'keydown') return true;

      if (isMod && event.key === 'c') {
        if (terminal.hasSelection()) {
          navigator.clipboard.writeText(terminal.getSelection()).catch(() => {});
          event.preventDefault();
          return false;
        }
        // No selection: let it through as SIGINT (Ctrl+C)
        return true;
      }

      if (isMod && event.key === 'v') {
        // preventDefault blocks the browser's native paste event on xterm's
        // hidden helper textarea. Without it we'd fire both our manual
        // terminal.paste(text) below AND xterm's textarea-paste handler,
        // which surfaces as an intermittent double-paste (the async clipboard
        // read racing the sync textarea paste).
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard.readText().then((text) => {
          if (text) terminal.paste(text);
        }).catch(() => {});
        return false;
      }

      return true;
    });

    // ResizeObserver to refit terminal on container resize. Guarded via
    // safeFit so that a display:none ancestor (inactive tab) doesn't shrink
    // the terminal to 1 col -- the observer still fires with a 0x0 rect in
    // that case.
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      safeFit();
    });
    resizeObserver.observe(container);

    // IntersectionObserver as a backstop: when a tab goes display:none →
    // block, ResizeObserver sometimes fails to fire for the revealed leaf
    // if its container dimensions happen to match its pre-hide dimensions.
    // IntersectionObserver always fires on visibility transitions, so a
    // refit here guarantees the terminal re-syncs with its new box.
    const intersectionObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          requestAnimationFrame(safeFit);
        }
      }
    });
    intersectionObserver.observe(container);

    // Report initial size
    onResize(terminal.cols, terminal.rows);

    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      selectionDisposable.dispose();
      oscDisposable.dispose();
      terminal.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={containerRef} className={styles.terminalContainer} />;
}
