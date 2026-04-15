import { useEffect, useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import styles from './SettingsPanel.module.css';

export default function SettingsPanel() {
  const { settings, loaded, loadSettings, updateTerminal, updateMonitoring, updateGeneral } =
    useSettingsStore();

  useEffect(() => {
    if (!loaded) loadSettings();
  }, [loaded, loadSettings]);

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

  if (!loaded) return null;

  const { terminal, monitoring, general } = settings;

  return (
    <div className={styles.container}>
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

      {/* General Settings */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>General</div>

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
      </div>
    </div>
  );
}
