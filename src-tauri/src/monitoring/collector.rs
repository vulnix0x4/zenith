use std::time::Duration;

use anyhow::{Context, Result};
use russh::ChannelMsg;

use crate::monitoring::types::MonitorData;
use crate::ssh::SharedSshHandle;

/// The compound command that reads all metrics in a single exec.
/// Uses a separator to split the output into sections.
const METRICS_CMD: &str = concat!(
    "cat /proc/stat 2>/dev/null && echo '---ZENITH_SEP---' && ",
    "cat /proc/meminfo 2>/dev/null && echo '---ZENITH_SEP---' && ",
    "cat /proc/net/dev 2>/dev/null && echo '---ZENITH_SEP---' && ",
    "cat /proc/uptime 2>/dev/null && echo '---ZENITH_SEP---' && ",
    "df -B1 / 2>/dev/null | tail -1 && echo '---ZENITH_SEP---' && ",
    "hostname 2>/dev/null"
);

const SEPARATOR: &str = "---ZENITH_SEP---";

/// Collect a single raw metrics sample over the SSH connection.
/// Used by the monitoring loop to maintain a sliding window so deltas
/// (CPU%, network rates) can be computed without taking two samples per tick.
pub(crate) async fn collect_sample(handle: &SharedSshHandle) -> Result<RawSample> {
    let output = exec_command(handle, METRICS_CMD).await?;
    parse_raw_sample(&output)
}

/// Execute a command on the SSH connection and collect all stdout.
async fn exec_command(handle: &SharedSshHandle, cmd: &str) -> Result<String> {
    let mut channel = handle
        .channel_open_session()
        .await
        .context("Failed to open monitoring channel")?;

    channel
        .exec(true, cmd)
        .await
        .context("Failed to exec monitoring command")?;

    let mut output = Vec::new();
    let timeout = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        output.extend_from_slice(data);
                    }
                    Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                        // stderr -- ignore but keep reading
                        let _ = data;
                    }
                    Some(ChannelMsg::Eof)
                    | Some(ChannelMsg::ExitStatus { .. })
                    | Some(ChannelMsg::Close)
                    | None => break,
                    _ => {}
                }
            }
            _ = &mut timeout => {
                break;
            }
        }
    }

    Ok(String::from_utf8_lossy(&output).to_string())
}

/// Parsed intermediate data from a single sample.
pub(crate) struct RawSample {
    cpu_active: u64,
    cpu_total: u64,
    mem_total_kb: u64,
    mem_available_kb: u64,
    net_rx_bytes: u64,
    net_tx_bytes: u64,
    disk_total: u64,
    disk_used: u64,
    disk_percent: f64,
    uptime_secs: f64,
    hostname: String,
}

fn parse_raw_sample(output: &str) -> Result<RawSample> {
    let sections: Vec<&str> = output.split(SEPARATOR).collect();
    if sections.len() < 6 {
        anyhow::bail!(
            "Expected 6 sections, got {}. Server may not be Linux.",
            sections.len()
        );
    }

    let cpu = parse_cpu_stat(sections[0])?;
    let (mem_total, mem_available) = parse_meminfo(sections[1])?;
    let (rx, tx) = parse_net_dev(sections[2])?;
    let uptime = parse_uptime(sections[3])?;
    let (dtotal, dused, dpct) = parse_df(sections[4])?;
    let hostname = sections[5].trim().to_string();

    Ok(RawSample {
        cpu_active: cpu.0,
        cpu_total: cpu.1,
        mem_total_kb: mem_total,
        mem_available_kb: mem_available,
        net_rx_bytes: rx,
        net_tx_bytes: tx,
        disk_total: dtotal,
        disk_used: dused,
        disk_percent: dpct,
        uptime_secs: uptime,
        hostname,
    })
}

/// Compute display metrics from a previous and current sample.
/// `elapsed_secs` is the wall-clock time between the two samples and is
/// used to convert byte-deltas into per-second rates.
pub(crate) fn compute_metrics(prev: &RawSample, curr: &RawSample, elapsed_secs: f64) -> MonitorData {
    // CPU: delta of active/total. /proc/stat is in jiffies, so the ratio
    // is independent of elapsed_secs.
    let cpu = if curr.cpu_total > prev.cpu_total {
        let total_diff = (curr.cpu_total - prev.cpu_total) as f64;
        let active_diff = (curr.cpu_active - prev.cpu_active) as f64;
        (active_diff / total_diff * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    // RAM (point-in-time, no delta needed)
    let ram_used_kb = curr.mem_total_kb.saturating_sub(curr.mem_available_kb);
    let ram = if curr.mem_total_kb > 0 {
        (ram_used_kb as f64 / curr.mem_total_kb as f64 * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    // Network rates: bytes-per-second normalised by elapsed time
    let elapsed = if elapsed_secs > 0.05 { elapsed_secs } else { 1.0 };
    let rx_rate = curr.net_rx_bytes.saturating_sub(prev.net_rx_bytes) as f64 / elapsed;
    let tx_rate = curr.net_tx_bytes.saturating_sub(prev.net_tx_bytes) as f64 / elapsed;

    MonitorData {
        cpu: round2(cpu),
        ram: round2(ram),
        ram_used: format_bytes_kb(ram_used_kb),
        ram_total: format_bytes_kb(curr.mem_total_kb),
        network_down: format_rate(rx_rate),
        network_up: format_rate(tx_rate),
        disk: round2(curr.disk_percent),
        disk_used: format_bytes(curr.disk_used),
        disk_total: format_bytes(curr.disk_total),
        uptime: format_uptime(curr.uptime_secs),
        hostname: curr.hostname.clone(),
    }
}

// ---------------------------------------------------------------------------
// Parsers for individual /proc entries
// ---------------------------------------------------------------------------

/// Parse the first "cpu" line from /proc/stat.
/// Returns (active_ticks, total_ticks).
fn parse_cpu_stat(section: &str) -> Result<(u64, u64)> {
    for line in section.lines() {
        let line = line.trim();
        if line.starts_with("cpu ") || line.starts_with("cpu\t") {
            let parts: Vec<u64> = line
                .split_whitespace()
                .skip(1)
                .filter_map(|s| s.parse().ok())
                .collect();

            if parts.len() < 4 {
                continue;
            }

            // user nice system idle [iowait irq softirq steal ...]
            let user = parts[0];
            let nice = parts[1];
            let system = parts[2];
            let idle = parts[3];
            let iowait = parts.get(4).copied().unwrap_or(0);
            let irq = parts.get(5).copied().unwrap_or(0);
            let softirq = parts.get(6).copied().unwrap_or(0);
            let steal = parts.get(7).copied().unwrap_or(0);

            let active = user + nice + system + irq + softirq + steal;
            let total = active + idle + iowait;
            return Ok((active, total));
        }
    }
    anyhow::bail!("Could not find cpu line in /proc/stat output");
}

/// Parse MemTotal and MemAvailable from /proc/meminfo.
/// Returns (total_kb, available_kb).
fn parse_meminfo(section: &str) -> Result<(u64, u64)> {
    let mut total: Option<u64> = None;
    let mut available: Option<u64> = None;

    for line in section.lines() {
        let line = line.trim();
        if line.starts_with("MemTotal:") {
            total = extract_kb_value(line);
        } else if line.starts_with("MemAvailable:") {
            available = extract_kb_value(line);
        }
        if total.is_some() && available.is_some() {
            break;
        }
    }

    Ok((total.unwrap_or(0), available.unwrap_or(0)))
}

/// Extract the numeric kB value from a /proc/meminfo line like "MemTotal:  8046892 kB".
fn extract_kb_value(line: &str) -> Option<u64> {
    line.split_whitespace().nth(1)?.parse().ok()
}

/// Parse /proc/net/dev. Sum bytes received (col 1) and transmitted (col 9) across
/// all interfaces except "lo".
fn parse_net_dev(section: &str) -> Result<(u64, u64)> {
    let mut rx_total: u64 = 0;
    let mut tx_total: u64 = 0;

    for line in section.lines() {
        let line = line.trim();
        // Each interface line looks like: "eth0: 123 456 ..."
        if let Some((_iface, rest)) = line.split_once(':') {
            let iface = _iface.trim();
            if iface == "lo" {
                continue;
            }
            let nums: Vec<u64> = rest
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();

            if nums.len() >= 9 {
                rx_total += nums[0]; // bytes received
                tx_total += nums[8]; // bytes transmitted
            }
        }
    }

    Ok((rx_total, tx_total))
}

/// Parse /proc/uptime -- first number is total uptime in seconds.
fn parse_uptime(section: &str) -> Result<f64> {
    let trimmed = section.trim();
    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(first) = line.split_whitespace().next() {
            if let Ok(secs) = first.parse::<f64>() {
                return Ok(secs);
            }
        }
    }
    Ok(0.0)
}

/// Parse `df -B1 /` output (single data line after header).
/// Columns: filesystem total used available use% mountpoint
/// Returns (total_bytes, used_bytes, percent).
fn parse_df(section: &str) -> Result<(u64, u64, f64)> {
    let trimmed = section.trim();
    for line in trimmed.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("Filesystem") {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 5 {
            let total: u64 = parts[1].parse().unwrap_or(0);
            let used: u64 = parts[2].parse().unwrap_or(0);
            let pct_str = parts[4].trim_end_matches('%');
            let pct: f64 = pct_str.parse().unwrap_or(0.0);
            return Ok((total, used, pct));
        }
    }
    Ok((0, 0, 0.0))
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

/// Format kB value to a human-readable size (GB/MB).
fn format_bytes_kb(kb: u64) -> String {
    let bytes = kb as f64 * 1024.0;
    format_bytes_f64(bytes)
}

/// Format byte count to human-readable size.
fn format_bytes(b: u64) -> String {
    format_bytes_f64(b as f64)
}

fn format_bytes_f64(b: f64) -> String {
    const GB: f64 = 1_073_741_824.0;
    const MB: f64 = 1_048_576.0;

    if b >= GB {
        format!("{:.1} GB", b / GB)
    } else if b >= MB {
        format!("{:.0} MB", b / MB)
    } else {
        format!("{:.0} KB", b / 1024.0)
    }
}

/// Format a bytes-per-second rate to human-readable.
fn format_rate(bytes_per_sec: f64) -> String {
    const MB: f64 = 1_048_576.0;
    const KB: f64 = 1024.0;

    if bytes_per_sec >= MB {
        format!("{:.1} MB/s", bytes_per_sec / MB)
    } else if bytes_per_sec >= KB {
        format!("{:.1} KB/s", bytes_per_sec / KB)
    } else {
        format!("{:.0} B/s", bytes_per_sec)
    }
}

/// Format uptime seconds to a short human-readable string.
fn format_uptime(secs: f64) -> String {
    let total = secs as u64;
    let days = total / 86400;
    let hours = (total % 86400) / 3600;
    let minutes = (total % 3600) / 60;

    if days > 0 {
        format!("{}d {}h", days, hours)
    } else if hours > 0 {
        format!("{}h {}m", hours, minutes)
    } else {
        format!("{}m", minutes)
    }
}
