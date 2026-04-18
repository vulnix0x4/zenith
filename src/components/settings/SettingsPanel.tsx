import { useEffect, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save, open as openDialog } from '@tauri-apps/plugin-dialog';
import { useSettingsStore } from '../../stores/settingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import UpdatesSection from './UpdatesSection';
import styles from './SettingsPanel.module.css';

type StorageStatus = {
  keyring_available: boolean;
  in_memory_count: number;
};

export default function SettingsPanel() {
  const { settings, loaded, loadSettings, updateTerminal, updateMonitoring, updateGeneral } =
    useSettingsStore();
  const loadSessions = useSessionStore((s) => s.loadSessions);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);

  useEffect(() => {
    if (!loaded) loadSettings();
  }, [loaded, loadSettings]);

  useEffect(() => {
    invoke<StorageStatus>('get_credential_storage_status')
      .then(setStorageStatus)
      .catch((err) => console.error('Failed to query credential storage status:', err));
  }, []);

  const handleNumberChange = useCallback(
    (
      section: 'terminal' | 'monitoring' | 'general',
      key: string,
      value: string,
      isFloat = false
    ) => {
      const num = isFloat ? parseFloat(value) : parseInt(value, 10);
      if (isNaN(num)) return;
      if (section === 'terminal') updateTerminal({ [key]: num });
      else if (section === 'monitoring') updateMonitoring({ [key]: num });
      else updateGeneral({ [key]: num });
    },
    [updateTerminal, updateMonitoring, updateGeneral]
  );

  const handleExport = useCallback(async () => {
    try {
      const path = await save({
        title: 'Export Sessions',
        defaultPath: 'zenith-sessions.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (path) {
        await invoke('export_sessions_file', { path });
      }
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, []);

  const handleImport = useCallback(async () => {
    try {
      const path = await openDialog({
        title: 'Import Sessions',
        multiple: false,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (path) {
        await invoke('import_sessions_file', { path });
        loadSessions();
      }
    } catch (err) {
      console.error('Import failed:', err);
    }
  }, [loadSessions]);

  if (!loaded) return null;

  const { terminal, monitoring, general } = settings;

  return (
    <div className={styles.container}>
      {/* Updates */}
      <UpdatesSection />

      {/* Credential storage warning (only when OS keyring is unavailable) */}
      {storageStatus && !storageStatus.keyring_available && (
        <div className={styles.warning} role="status">
          <span className={styles.warningIcon} aria-hidden="true">!</span>
          <span>
            OS keyring not available on this system. Credentials are stored in memory only (lost on app exit).
          </span>
        </div>
      )}

      {/* General Settings */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>General</div>

        <div className={styles.row}>
          <span className={styles.label}>Auto Collapse Sidebar</span>
          <div
            className={`${styles.toggle} ${general.autoCollapseSidebar ? styles.toggleActive : ''}`}
            onClick={() => updateGeneral({ autoCollapseSidebar: !general.autoCollapseSidebar })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Auto Reconnect</span>
          <div
            className={`${styles.toggle} ${general.autoReconnect ? styles.toggleActive : ''}`}
            onClick={() => updateGeneral({ autoReconnect: !general.autoReconnect })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Reconnect Delay (sec)</span>
          <input
            className={styles.inputNumber}
            type="number"
            min={1}
            max={60}
            value={general.reconnectDelay}
            onChange={(e) => handleNumberChange('general', 'reconnectDelay', e.target.value)}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Confirm on Close</span>
          <div
            className={`${styles.toggle} ${general.confirmOnClose ? styles.toggleActive : ''}`}
            onClick={() => updateGeneral({ confirmOnClose: !general.confirmOnClose })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Select to Copy</span>
          <div
            className={`${styles.toggle} ${general.selectToCopy ? styles.toggleActive : ''}`}
            onClick={() => updateGeneral({ selectToCopy: !general.selectToCopy })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Files Follow Terminal CWD</span>
          <div
            className={`${styles.toggle} ${general.followTerminalCwd ? styles.toggleActive : ''}`}
            onClick={() => updateGeneral({ followTerminalCwd: !general.followTerminalCwd })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Auto-Inject Shell Integration</span>
          <div
            className={`${styles.toggle} ${general.injectShellIntegration ? styles.toggleActive : ''}`}
            onClick={() => updateGeneral({ injectShellIntegration: !general.injectShellIntegration })}
          />
        </div>
      </div>

      {/* Terminal Settings */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Terminal</div>

        <div className={styles.row}>
          <span className={styles.label}>Font Family</span>
          <input
            className={styles.inputText}
            type="text"
            value={terminal.fontFamily}
            onChange={(e) => updateTerminal({ fontFamily: e.target.value })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Font Size</span>
          <input
            className={styles.inputNumber}
            type="number"
            min={8}
            max={32}
            value={terminal.fontSize}
            onChange={(e) => handleNumberChange('terminal', 'fontSize', e.target.value)}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Line Height</span>
          <input
            className={styles.inputNumber}
            type="number"
            min={1}
            max={3}
            step={0.1}
            value={terminal.lineHeight}
            onChange={(e) => handleNumberChange('terminal', 'lineHeight', e.target.value, true)}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Scrollback Lines</span>
          <input
            className={styles.inputNumber}
            type="number"
            min={1000}
            max={100000}
            step={1000}
            value={terminal.scrollbackLines}
            onChange={(e) => handleNumberChange('terminal', 'scrollbackLines', e.target.value)}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Cursor Style</span>
          <select
            className={styles.select}
            value={terminal.cursorStyle}
            onChange={(e) => updateTerminal({ cursorStyle: e.target.value })}
          >
            <option value="block">Block</option>
            <option value="underline">Underline</option>
            <option value="bar">Bar</option>
          </select>
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Cursor Blink</span>
          <div
            className={`${styles.toggle} ${terminal.cursorBlink ? styles.toggleActive : ''}`}
            onClick={() => updateTerminal({ cursorBlink: !terminal.cursorBlink })}
          />
        </div>
      </div>

      {/* Monitoring Settings */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Monitoring</div>

        <div className={styles.row}>
          <span className={styles.label}>Enabled</span>
          <div
            className={`${styles.toggle} ${monitoring.enabled ? styles.toggleActive : ''}`}
            onClick={() => updateMonitoring({ enabled: !monitoring.enabled })}
          />
        </div>

        <div className={styles.row}>
          <span className={styles.label}>Refresh (sec)</span>
          <input
            className={styles.inputNumber}
            type="number"
            min={1}
            max={60}
            value={monitoring.refreshInterval}
            onChange={(e) => handleNumberChange('monitoring', 'refreshInterval', e.target.value)}
          />
        </div>
      </div>

      {/* Session Import/Export */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Sessions</div>

        <div className={styles.actionRow}>
          <button className={styles.actionBtn} onClick={handleExport}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export Sessions
          </button>
          <button className={styles.actionBtn} onClick={handleImport}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Import Sessions
          </button>
        </div>
      </div>
    </div>
  );
}
