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
    /// When true, the sidebar collapses automatically after the first SSH
    /// connection establishes (and re-collapses when the user clicks back
    /// into the terminal area). Originally only existed on the TS side --
    /// missing here meant `save_settings` silently dropped the field, so
    /// the toggle in the Settings panel never stuck.
    #[serde(default = "default_auto_collapse_sidebar")]
    pub auto_collapse_sidebar: bool,
    /// When true, the file browser auto-navigates to the terminal's current
    /// working directory whenever the shell emits an OSC 7 sequence.
    /// Defaulted via serde so older settings.json files keep loading.
    #[serde(default = "default_follow_terminal_cwd")]
    pub follow_terminal_cwd: bool,
    /// When true, after SSH connect Zenith pipes a small setup snippet into
    /// the remote shell so it emits OSC 7 on every prompt without the user
    /// having to edit their .bashrc / .zshrc by hand.
    #[serde(default = "default_inject_shell_integration")]
    pub inject_shell_integration: bool,
    /// When true, the file browser shows dotfiles (entries starting with `.`).
    /// Off by default -- most users don't want config noise in the listing.
    #[serde(default)]
    pub show_hidden_files: bool,
}

fn default_auto_collapse_sidebar() -> bool {
    true
}

fn default_follow_terminal_cwd() -> bool {
    true
}

fn default_inject_shell_integration() -> bool {
    true
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            auto_reconnect: false,
            reconnect_delay: 5,
            confirm_on_close: true,
            select_to_copy: true,
            auto_collapse_sidebar: true,
            follow_terminal_cwd: true,
            inject_shell_integration: true,
            show_hidden_files: false,
        }
    }
}
