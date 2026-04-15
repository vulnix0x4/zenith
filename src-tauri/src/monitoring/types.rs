use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorData {
    pub cpu: f64,
    pub ram: f64,
    pub ram_used: String,
    pub ram_total: String,
    pub network_up: String,
    pub network_down: String,
    pub disk: f64,
    pub disk_used: String,
    pub disk_total: String,
    pub uptime: String,
    pub hostname: String,
}
