import { useState, useEffect, type FormEvent } from 'react';
import { v4 as uuid } from 'uuid';
import { invoke } from '@tauri-apps/api/core';
import type { Session, AuthMethod } from '../../stores/sessionStore';
import styles from './SessionDialog.module.css';

interface SessionDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (session: Session) => void;
  session?: Session | null;
}

export default function SessionDialog({ open, onClose, onSave, session }: SessionDialogProps) {
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [savePassword, setSavePassword] = useState(false);
  const [passwordField, setPasswordField] = useState('');

  useEffect(() => {
    if (session) {
      setName(session.name);
      setHostname(session.hostname);
      setPort(String(session.port));
      setUsername(session.username);
      setAuthMethod(session.authMethod);
      setPrivateKeyPath(session.privateKeyPath ?? '');
    } else {
      setName('');
      setHostname('');
      setPort('22');
      setUsername('');
      setAuthMethod('password');
      setPrivateKeyPath('');
    }
    setSavePassword(false);
    setPasswordField('');
  }, [session, open]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hostname || !username) return;

    const now = new Date().toISOString();
    const sessionId = session?.id ?? uuid();
    const saved: Session = {
      id: sessionId,
      name: name || `${username}@${hostname}`,
      hostname,
      port: parseInt(port, 10) || 22,
      username,
      authMethod,
      privateKeyPath: authMethod === 'privateKey' ? privateKeyPath || undefined : undefined,
      folderId: session?.folderId,
      colorLabel: session?.colorLabel,
      notes: session?.notes,
      lastConnected: session?.lastConnected,
      createdAt: session?.createdAt ?? now,
      sortOrder: session?.sortOrder ?? 0,
    };

    onSave(saved);

    // Save credential to keychain if checkbox is checked and password provided
    if (savePassword && passwordField && authMethod === 'password') {
      try {
        await invoke('save_credential', { sessionId, password: passwordField });
      } catch (err) {
        console.error('Failed to save credential:', err);
      }
    }

    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.overlay} onClick={handleBackdropClick}>
      <div className={styles.dialog}>
        <div className={styles.header}>
          <span className={styles.title}>
            {session ? 'Edit Session' : 'New Session'}
          </span>
          <button className={styles.closeBtn} onClick={onClose}>
            &times;
          </button>
        </div>
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.label}>
            Name
            <input
              className={styles.input}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
              autoFocus
            />
          </label>
          <label className={styles.label}>
            Host
            <input
              className={styles.input}
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="192.168.1.1"
            />
          </label>
          <div className={styles.row}>
            <label className={styles.label} style={{ flex: 1 }}>
              Port
              <input
                className={styles.input}
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
              />
            </label>
            <label className={styles.label} style={{ flex: 2 }}>
              Username
              <input
                className={styles.input}
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
              />
            </label>
          </div>
          <div className={styles.label}>
            Auth Method
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="authMethod"
                  checked={authMethod === 'password'}
                  onChange={() => setAuthMethod('password')}
                  className={styles.radio}
                />
                Password
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="authMethod"
                  checked={authMethod === 'privateKey'}
                  onChange={() => setAuthMethod('privateKey')}
                  className={styles.radio}
                />
                Private Key
              </label>
            </div>
          </div>
          {authMethod === 'privateKey' && (
            <label className={styles.label}>
              Private Key Path
              <input
                className={styles.input}
                type="text"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
              />
            </label>
          )}
          {authMethod === 'password' && (
            <>
              <label className={styles.label}>
                Password
                <input
                  className={styles.input}
                  type="password"
                  value={passwordField}
                  onChange={(e) => setPasswordField(e.target.value)}
                  placeholder="Enter password to save"
                />
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="checkbox"
                  checked={savePassword}
                  onChange={(e) => setSavePassword(e.target.checked)}
                  className={styles.radio}
                />
                Save password in keychain
              </label>
            </>
          )}
          <div className={styles.actions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={styles.saveBtn}>
              {session ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
