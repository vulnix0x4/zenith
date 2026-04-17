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

    // Fit after open
    fitAddon.fit();

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
          return false; // Prevent xterm from processing
        }
        // No selection: let it through as SIGINT (Ctrl+C)
        return true;
      }

      if (isMod && event.key === 'v') {
        navigator.clipboard.readText().then((text) => {
          terminal.paste(text);
        }).catch(() => {});
        return false; // Prevent default
      }

      return true;
    });

    // ResizeObserver to refit terminal on container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    // Report initial size
    onResize(terminal.cols, terminal.rows);

    return () => {
      resizeObserver.disconnect();
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
