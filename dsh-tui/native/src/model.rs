//! Local render model: keep the latest revision of cells and views so a
//! resync discards anything stale before the next publication lands.

use crate::protocol::{Cell, View};

#[derive(Debug, Default)]
pub struct RenderModel {
    pub cells: Vec<Cell>,
    pub views: Vec<View>,
    pub last_revision: Option<u32>,
}

impl RenderModel {
    pub fn apply_window(&mut self, revision: u32, cells: Vec<Cell>, views: Vec<View>) {
        if self.last_revision != Some(revision) {
            self.cells = cells;
            self.views = views;
            self.last_revision = Some(revision);
        }
    }
}
