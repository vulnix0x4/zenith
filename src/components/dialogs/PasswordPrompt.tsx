import { useState, useEffect, type FormEvent } from 'react';
import styles from './QuickConnect.module.css';

interface PasswordPromptProps {
  open: boolean;
  sessionName: string;
  onClose: () => void;
  onSubmit: (password: string) => void;
}

export default function PasswordPrompt({ open, sessionName, onClose, onSubmit }: PasswordPromptProps) {
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (open) setPassword('');
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(password);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <span className={styles.title}>Password Required</span>
          <button className={styles.closeBtn} onClick={onClose}>
            &times;
          </button>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            Enter password for <strong style={{ color: 'var(--cyan)' }}>{sessionName}</strong>
          </div>
          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
              autoFocus
            />
          </label>
          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.connectBtn}>
              Connect
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
