import { useState, type FormEvent } from 'react';
import styles from './QuickConnect.module.css';

interface QuickConnectProps {
  open: boolean;
  onClose: () => void;
  onConnect: (params: {
    hostname: string;
    port: number;
    username: string;
    password: string;
  }) => void;
}

export default function QuickConnect({ open, onClose, onConnect }: QuickConnectProps) {
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!hostname || !username) return;
    onConnect({
      hostname,
      port: parseInt(port, 10) || 22,
      username,
      password,
    });
    // Reset form
    setHostname('');
    setPort('22');
    setUsername('');
    setPassword('');
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <span className={styles.title}>Quick Connect</span>
          <button className={styles.closeBtn} onClick={onClose}>
            &times;
          </button>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Host
            <input
              className={styles.input}
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="192.168.1.1 or hostname"
              autoFocus
            />
          </label>
          <label className={styles.label}>
            Port
            <input
              className={styles.input}
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="22"
            />
          </label>
          <label className={styles.label}>
            Username
            <input
              className={styles.input}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
            />
          </label>
          <label className={styles.label}>
            Password
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="password"
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
