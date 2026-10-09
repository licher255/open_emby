//! Tajima DST 编码器 —— 刺绣机通用格式的二进制编解码（Rust 职责域：编解码）。
//! 布局：512 字节 ASCII 头 + 3 字节/针迹记录。
//! 坐标系：输入为 mm（y 向下为正），编码时翻转为机器坐标，单位 0.1mm。

use napi::bindgen_prelude::Buffer;
use napi_derive::napi;

pub const FLAG_STITCH: u32 = 0;
pub const FLAG_JUMP: u32 = 1;
pub const FLAG_COLOR: u32 = 2;

#[napi(object)]
#[derive(Clone, Copy)]
pub struct StitchRecord {
    /// 相对上一针的位移 mm
    pub dx_mm: f64,
    pub dy_mm: f64,
    /// 0=stitch 1=jump 2=color_change
    pub flag: u32,
}

const WEIGHTS: [i32; 5] = [81, 27, 9, 3, 1];

/// Balanced ternary: each weight is used at most once with coefficient -1, 0 or 1.
fn encode_axis(delta: i32, is_x: bool, b: &mut [u8; 3]) {
    let mut d = delta;
    for (i, w) in WEIGHTS.iter().enumerate() {
        if d > *w / 2 {
            set_bit(b, i, true, is_x);
            d -= w;
        } else if d < -(*w / 2) {
            set_bit(b, i, false, is_x);
            d += w;
        }
    }
    debug_assert_eq!(d, 0);
}

/// i=权重序号(81,27,9,3,1 -> 0..4)，positive=正方向
fn set_bit(b: &mut [u8; 3], i: usize, positive: bool, is_x: bool) {
    // 权重 1/9 在 byte0，3/27 在 byte1，81 在 byte2
    let (byte, x_positive, y_positive) = match i {
        4 => (0usize, 0u8, 7u8), // 1
        3 => (1, 0, 7),          // 3
        2 => (0, 2, 5),          // 9
        1 => (1, 2, 5),          // 27
        _ => (2, 2, 5),          // 81
    };
    let bit = if is_x {
        x_positive + u8::from(!positive)
    } else {
        y_positive - u8::from(!positive)
    };
    b[byte] |= 1 << bit;
}

fn push_record(out: &mut Vec<u8>, dx: i32, dy: i32, flag: u32) {
    let mut b = [0u8; 3];
    // 机器坐标 y 向上，内部坐标 y 向下 -> 翻转
    encode_axis(dx, true, &mut b);
    encode_axis(-dy, false, &mut b);
    b[2] |= 0x03; // 常置位
    match flag {
        FLAG_JUMP => b[2] |= 0x80,
        FLAG_COLOR => b[2] |= 0xC0,
        _ => {}
    }
    out.extend_from_slice(&b);
}

/// 长位移拆分为 <=121 (0.1mm) 的多段
fn push_move(out: &mut Vec<u8>, dx: i32, dy: i32, flag: u32) {
    let n = ((dx as i64).abs().max((dy as i64).abs()) + 120) / 121;
    let n = n.max(1);
    let (mut px, mut py) = (0, 0);
    for i in 1..=n {
        let x = (dx as f64 * i as f64 / n as f64).round() as i32;
        let y = (dy as f64 * i as f64 / n as f64).round() as i32;
        push_record(out, x - px, y - py, flag);
        px = x;
        py = y;
    }
}

/// 编码完整花版为 DST 字节流
#[napi]
pub fn dst_encode(records: Vec<StitchRecord>, name: String) -> Buffer {
    let mut body: Vec<u8> = Vec::new();
    let (mut cx, mut cy) = (0i64, 0i64);
    let (mut px, mut nx, mut py, mut ny) = (0i64, 0i64, 0i64, 0i64);
    let mut stitch_count = 0u32;
    let mut color_changes = 0u32;

    for r in &records {
        let dx = (r.dx_mm * 10.0).round() as i32;
        let dy = (r.dy_mm * 10.0).round() as i32;
        if r.flag == FLAG_COLOR {
            push_record(&mut body, 0, 0, FLAG_COLOR);
            color_changes += 1;
            continue;
        }
        push_move(&mut body, dx, dy, r.flag);
        cx += dx as i64;
        cy += dy as i64;
        px = px.max(cx);
        nx = nx.max(-cx);
        py = py.max(cy);
        ny = ny.max(-cy);
        if r.flag == FLAG_STITCH {
            stitch_count += 1;
        }
    }
    // END 记录
    body.extend_from_slice(&[0x00, 0x00, 0xF3]);

    let header = build_header(&name, stitch_count, color_changes, px, nx, py, ny);
    let mut out = Vec::with_capacity(512 + body.len());
    out.extend_from_slice(&header);
    out.extend_from_slice(&body);
    Buffer::from(out)
}

fn build_header(name: &str, st: u32, co: u32, px: i64, nx: i64, py: i64, ny: i64) -> [u8; 512] {
    let mut s = String::new();
    let clean: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .take(16)
        .collect();
    s.push_str(&format!("LA:{:<16}\r", clean));
    s.push_str(&format!("ST:{:>7}\r", st));
    s.push_str(&format!("CO:{:>3}\r", co));
    s.push_str(&format!("+X:{:>5}\r", px));
    s.push_str(&format!("-X:{:>5}\r", nx));
    s.push_str(&format!("+Y:{:>5}\r", py));
    s.push_str(&format!("-Y:{:>5}\r", ny));
    s.push_str(&format!("AX:+{:>5}\r", 0));
    s.push_str(&format!("AY:+{:>5}\r", 0));
    s.push_str(&format!("MX:+{:>5}\r", 0));
    s.push_str(&format!("MY:+{:>5}\r", 0));
    s.push_str(&format!("PD:{:>6}\r", "******"));
    let mut header = [0x20u8; 512];
    let bytes = s.as_bytes();
    header[..bytes.len().min(512)].copy_from_slice(&bytes[..bytes.len().min(512)]);
    header
}

#[cfg(test)]
mod tests {
    use super::*;
    fn decode(b: &[u8]) -> (i32, i32) {
        let bit = |byte: usize, pos: u8| ((b[byte] >> pos) & 1) as i32;
        let x = 81 * (bit(2, 2) - bit(2, 3))
            + 27 * (bit(1, 2) - bit(1, 3))
            + 9 * (bit(0, 2) - bit(0, 3))
            + 3 * (bit(1, 0) - bit(1, 1))
            + bit(0, 0)
            - bit(0, 1);
        let y = 81 * (bit(2, 5) - bit(2, 4))
            + 27 * (bit(1, 5) - bit(1, 4))
            + 9 * (bit(0, 5) - bit(0, 4))
            + 3 * (bit(1, 7) - bit(1, 6))
            + bit(0, 7)
            - bit(0, 6);
        (x, -y)
    }
    #[test]
    fn all_dst_displacements_and_control_bits() {
        for dx in -121..=121 {
            for dy in -121..=121 {
                let mut b = Vec::new();
                push_record(&mut b, dx, dy, FLAG_STITCH);
                assert_eq!(decode(&b), (dx, dy));
                assert_eq!(b[2] & 0xc3, 3);
            }
        }
        let mut b = Vec::new();
        push_record(&mut b, 2, 0, FLAG_STITCH);
        assert_eq!(b, vec![2, 1, 3]);
        b.clear();
        push_record(&mut b, 0, 2, FLAG_JUMP);
        assert_eq!(b, vec![128, 64, 131]);
        b.clear();
        push_record(&mut b, 0, 0, FLAG_COLOR);
        assert_eq!(b, vec![0, 0, 195]);
    }
    #[test]
    fn long_moves_keep_endpoints_and_linear_direction() {
        let mut b = Vec::new();
        push_move(&mut b, 600, -223, FLAG_JUMP);
        let (mut x, mut y) = (0, 0);
        for record in b.chunks_exact(3) {
            let (dx, dy) = decode(record);
            assert!(dx.abs() <= 121 && dy.abs() <= 121);
            assert_eq!(record[2] & 0xc3, 0x83);
            x += dx;
            y += dy;
            assert!((y as f64 + x as f64 * 223.0 / 600.0).abs() <= 0.6);
        }
        assert_eq!((x, y), (600, -223));
    }
}
