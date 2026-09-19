//! 内置节点注册表，对齐 ComfyUI nodes.py 的 NODE_CLASS_MAPPINGS。
//! 新增节点只需在此登记；插件系统后续可通过同一注册表扩展。

use crate::node::NodeDef;
use std::collections::BTreeMap;

mod emby_nodes;
mod image_nodes;
mod model_nodes;

pub fn build_registry() -> BTreeMap<&'static str, NodeDef> {
    let mut m = BTreeMap::new();
    let groups = [image_nodes::defs(), emby_nodes::defs(), model_nodes::defs()];
    for def in groups.into_iter().flatten() {
        m.insert(def.class_type, def);
    }
    m
}
