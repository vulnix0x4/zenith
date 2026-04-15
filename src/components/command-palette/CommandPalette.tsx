import { useState, useEffect, useRef, useCallback } from 'react';
import { useSessionStore, type Session } from '../../stores/sessionStore';
import styles from './CommandPalette.module.css';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onSelectSession: (session: Session) => void;
  connectedSessionIds: Set<string>;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export default function CommandPalette({
  open,
  onClose,
  onSelectSession,
  connectedSessionIds,
}: CommandPaletteProps) {
  const { sessions } = useSessionStore();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query
    ? sessions.filter(
        (s) =>
          fuzzyMatch(s.name, query) ||
          fuzzyMatch(s.hostname, query) ||
          fuzzyMatch(s.username, query)
      )
    : sessions;

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus after overlay renders
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered[selectedIndex]) {
            onSelectSession(filtered[selectedIndex]);
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onSelectSession, onClose]
  );

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.palette} onKeyDown={handleKeyDown}>
        <div className={styles.inputWrap}>
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions..."
          />
        </div>
        <div className={styles.results}>
          {filtered.length === 0 && (
            <div className={styles.empty}>No sessions found</div>
          )}
          {filtered.map((session, index) => {
            const isConnected = connectedSessionIds.has(session.id);
            return (
              <div
                key={session.id}
                className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                onClick={() => {
                  onSelectSession(session);
                  onClose();
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span
                  className={`${styles.dot} ${isConnected ? styles.dotConnected : ''}`}
                />
                <span className={styles.resultName}>{session.name}</span>
                <span className={styles.resultHost}>
                  {session.username}@{session.hostname}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
