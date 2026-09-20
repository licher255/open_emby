//! open_emby native core — 性能密集计算的 Rust 实现。
//! 职责边界：编解码(DST) / 图像处理(量化、连通域、phash) / 后续加解密、文件索引。
//! UI 与生态编排留在 Electron/Node 侧，经 napi 调用本 crate。

mod dst;
mod img;
mod stitch;

pub use dst::{dst_encode, StitchRecord};
pub use img::{analyze_image, canvas_resize, phash, save_resized_png, AnalysisResult, StitchRegion};
pub use stitch::{generate_stitches, StitchPoint, StitchResult};
