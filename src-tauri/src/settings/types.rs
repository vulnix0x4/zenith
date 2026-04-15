use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub terminal: TerminalSettings,
    pub monitoring: MonitoringSettings,
    pub general: GeneralSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            terminal: TerminalSettings::default(),
            monitoring: MonitoringSettings::default(),
            general: GeneralSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSettings {
    pub font_family: String,
    pub font_size: u32,
    pub line_height: f64,
    pub scrollback_lines: u32,
    pub cursor_style: String,
    pub cursor_blink: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            font_family: "JetBrains Mono".to_string(),
            font_size: 14,
            line_height: 1.4,
            scrollback_lines: 10000,
            cursor_style: "bar".to_string(),
            cursor_blink: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitoringSettings {
    pub enabled: bool,
    pub refresh_interval: u32,
}

impl Default for MonitoringSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            refresh_interval: 3,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneralSettings {
    pub auto_reconnect: bool,
    pub reconnect_delay: u32,
    pub confirm_on_close: bool,
    pub select_to_copy: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            auto_reconnect: false,
            reconnect_delay: 5,
            confirm_on_close: true,
            select_to_copy: true,
        }
    }
}
