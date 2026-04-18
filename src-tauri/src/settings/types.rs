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

impl AppSettings {
    /// Clamp numeric fields to sane ranges. Protects against a user
    /// hand-editing settings.json with garbage values (e.g. fontSize: -5,
    /// refreshInterval: 99999) breaking the UI. Called on load.
    pub fn clamp_into_range(&mut self) {
        self.terminal.font_size = self.terminal.font_size.clamp(8, 32);
        // line_height is f64; clamp with explicit NaN handling (NaN -> default).
        if !self.terminal.line_height.is_finite() {
            self.terminal.line_height = 1.4;
        }
        self.terminal.line_height = self.terminal.line_height.clamp(1.0, 3.0);
        self.terminal.scrollback_lines = self.terminal.scrollback_lines.clamp(100, 1_000_000);
        self.monitoring.refresh_interval = self.monitoring.refresh_interval.clamp(1, 60);
        self.general.reconnect_delay = self.general.reconnect_delay.clamp(1, 300);
        // SSH keepalive: 0 means "disabled", otherwise a sensible upper bound
        // of 5 minutes (matching the connection-side backoff cap).
        self.general.ssh_keepalive_seconds =
            self.general.ssh_keepalive_seconds.clamp(0, 300);
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
    /// When true, clicking outside the sidebar (terminal area, title bar,
    /// any non-sidebar element) collapses it. Off preserves an always-open
    /// sidebar layout for users who dock the app wide.
    #[serde(default = "default_auto_collapse_sidebar")]
    pub auto_collapse_sidebar: bool,
    /// When true, mark hostnames / usernames / session names / file paths
    /// with a CSS blur so the user can share or record their screen
    /// without leaking customer-identifying strings. Toggled at runtime;
    /// affects nothing on disk.
    #[serde(default)]
    pub privacy_mode: bool,
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
    /// How often (in seconds) russh sends a keepalive probe on active SSH
    /// sessions. `0` disables keepalives. Used to keep corporate firewalls
    /// and NAT middleboxes from silently dropping idle sessions.
    ///
    /// Defaulted via serde so older settings.json files loaded prior to
    /// this field existing continue to load without migration.
    #[serde(default = "default_ssh_keepalive_seconds")]
    pub ssh_keepalive_seconds: u32,
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

fn default_ssh_keepalive_seconds() -> u32 {
    30
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            auto_reconnect: false,
            reconnect_delay: 5,
            confirm_on_close: true,
            select_to_copy: true,
            auto_collapse_sidebar: true,
            privacy_mode: false,
            follow_terminal_cwd: true,
            inject_shell_integration: true,
            show_hidden_files: false,
            ssh_keepalive_seconds: default_ssh_keepalive_seconds(),
        }
    }
}
