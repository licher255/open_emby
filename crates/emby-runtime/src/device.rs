//! Device discovery for backend selection.
//!
//! We cannot assume one runtime covers every vendor, so the launcher probes the
//! machine first and then picks a backend tier:
//!
//!   CUDA (NVIDIA) -> Vulkan (AMD/Intel/Moore Threads/older NVIDIA)
//!   -> vendor EP (CANN/OpenVINO/QNN) -> CPU
//!
//! The probe is best-effort: missing tools simply mean "unknown", never an error.
use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Vendor {
    Nvidia,
    Amd,
    Intel,
    Huawei,
    MooreThreads,
    Unknown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub vendor: Vendor,
    pub name: String,
    pub memory_mb: Option<u64>,
    /// Backend tier that should be used for this device.
    pub backend: String,
    /// Where the information came from (nvidia-smi, wmi, cpu).
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceReport {
    pub os: String,
    pub devices: Vec<DeviceInfo>,
    pub recommended_backend: String,
}

impl DeviceReport {
    pub fn has_vendor(&self, vendor: Vendor) -> bool {
        self.devices.iter().any(|device| device.vendor == vendor)
    }
}

pub fn classify(name: &str) -> Vendor {
    let lower = name.to_ascii_lowercase();
    if lower.contains("nvidia") || lower.contains("geforce") || lower.contains("quadro") || lower.contains("rtx") {
        return Vendor::Nvidia;
    }
    if lower.contains("amd") || lower.contains("radeon") || lower.contains("firepro") {
        return Vendor::Amd;
    }
    if lower.contains("intel") || lower.contains("arc a") || lower.contains("iris") || lower.contains("uhd graphics") {
        return Vendor::Intel;
    }
    if lower.contains("huawei") || lower.contains("ascend") || lower.contains("910b") || lower.contains("310p") {
        return Vendor::Huawei;
    }
    if lower.contains("moore") || lower.contains("mtt") || lower.contains("mt s") {
        return Vendor::MooreThreads;
    }
    Vendor::Unknown
}

pub fn backend_for(vendor: Vendor) -> &'static str {
    match vendor {
        Vendor::Nvidia => "cuda",
        Vendor::Amd => if cfg!(windows) { "vulkan" } else { "rocm" },
        Vendor::Intel => "vulkan",
        Vendor::Huawei => "cann",
        Vendor::MooreThreads => "vulkan",
        Vendor::Unknown => "vulkan",
    }
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    command.args(args);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

/// NVIDIA exposes precise VRAM through nvidia-smi; this is the most reliable probe.
fn probe_nvidia() -> Vec<DeviceInfo> {
    let Some(text) = run("nvidia-smi", &["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split(',').map(str::trim);
            let name = parts.next()?.to_string();
            let memory = parts.next().and_then(|value| value.parse::<u64>().ok());
            if name.is_empty() { return None; }
            Some(DeviceInfo {
                vendor: Vendor::Nvidia,
                name,
                memory_mb: memory,
                backend: "cuda".into(),
                source: "nvidia-smi".into(),
            })
        })
        .collect()
}

/// Windows fallback: WMI lists every display adapter (AMD, Intel, Moore Threads...).
/// AdapterRAM is 32-bit and often wrong above 4 GB, so it is recorded but not trusted.
#[cfg(windows)]
fn probe_wmi() -> Vec<DeviceInfo> {
    let script = "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress";
    let Some(text) = run("powershell", &["-NoProfile", "-NonInteractive", "-Command", script]) else {
        return Vec::new();
    };
    let value: serde_json::Value = serde_json::from_str(text.trim()).ok().unwrap_or(serde_json::Value::Null);
    let items = match value {
        serde_json::Value::Array(items) => items,
        serde_json::Value::Object(_) => vec![value],
        _ => return Vec::new(),
    };
    items.into_iter().filter_map(|item| {
        let name = item.get("Name")?.as_str()?.to_string();
        if name.is_empty() { return None; }
        let vendor = classify(&name);
        Some(DeviceInfo {
            vendor,
            name,
            memory_mb: None,
            backend: backend_for(vendor).to_string(),
            source: "wmi".into(),
        })
    }).collect()
}

#[cfg(not(windows))]
fn probe_wmi() -> Vec<DeviceInfo> { Vec::new() }

pub fn probe() -> DeviceReport {
    let mut devices = probe_nvidia();
    // nvidia-smi already described the NVIDIA cards precisely; WMI would duplicate them.
    for device in probe_wmi() {
        if devices.iter().any(|existing| existing.name.eq_ignore_ascii_case(&device.name)) {
            continue;
        }
        devices.push(device);
    }
    if devices.is_empty() {
        devices.push(DeviceInfo {
            vendor: Vendor::Unknown,
            name: "CPU".into(),
            memory_mb: None,
            backend: "cpu".into(),
            source: "fallback".into(),
        });
    }
    let recommended = if devices.iter().any(|device| device.backend == "cuda") {
        "cuda"
    } else if devices.iter().any(|device| device.backend == "rocm") {
        "rocm"
    } else if devices.iter().any(|device| device.backend == "cann") {
        "cann"
    } else if devices.iter().any(|device| device.backend == "vulkan") {
        "vulkan"
    } else {
        "cpu"
    };
    DeviceReport {
        os: std::env::consts::OS.to_string(),
        devices,
        recommended_backend: recommended.to_string(),
    }
}
