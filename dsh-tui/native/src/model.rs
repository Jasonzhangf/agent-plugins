//! Atomic render model staged behind complete projection publications.

use std::collections::{HashMap, HashSet};

use crate::protocol::{Cell, View};

#[derive(Debug)]
pub enum ProjectionError {
    Resync(String),
    Fatal(String),
}

#[derive(Debug, Default)]
pub struct RenderModel {
    pub cells: Vec<Cell>,
    pub views: Vec<View>,
    pub publication_revision: u64,
    staged: Option<StagedPublication>,
}

#[derive(Debug)]
struct StagedPublication {
    revision: u64,
    windows: HashMap<u32, (Vec<Cell>, Vec<View>)>,
    bytes: usize,
}

impl RenderModel {
    pub fn stage_window(
        &mut self,
        revision: u64,
        index: u32,
        cells: Vec<Cell>,
        views: Vec<View>,
        window_bytes: usize,
    ) -> Result<(), ProjectionError> {
        if self
            .staged
            .as_ref()
            .is_some_and(|staged| staged.revision != revision)
        {
            return Err(ProjectionError::Resync(
                "projection staging revision changed before commit".into(),
            ));
        }
        if window_bytes > 8 * 1024 * 1024 {
            return Err(ProjectionError::Fatal(
                "projection window exceeds byte budget".into(),
            ));
        }
        if cells.len() > 256 || views.len() > 256 {
            return Err(ProjectionError::Fatal(
                "projection window exceeds cell or view count budget".into(),
            ));
        }
        if index > 255 {
            return Err(ProjectionError::Fatal(
                "projection window index exceeds budget".into(),
            ));
        }
        let staged = self.staged.get_or_insert_with(|| StagedPublication {
            revision,
            windows: HashMap::new(),
            bytes: 0,
        });
        staged.bytes = staged
            .bytes
            .checked_add(window_bytes)
            .ok_or_else(|| ProjectionError::Fatal("projection staged byte overflow".into()))?;
        if staged.bytes > 64 * 1024 * 1024 {
            return Err(ProjectionError::Fatal(
                "projection staged publication exceeds byte budget".into(),
            ));
        }
        if staged.windows.insert(index, (cells, views)).is_some() {
            return Err(ProjectionError::Resync(format!(
                "projection window index {} duplicated",
                index
            )));
        }
        Ok(())
    }

    pub fn commit(&mut self, revision: u64, total_windows: u32) -> Result<(), ProjectionError> {
        let Some(staged) = self.staged.as_mut() else {
            return Err(ProjectionError::Resync(
                "projection commit without staged windows".into(),
            ));
        };
        if staged.revision != revision {
            return Err(ProjectionError::Resync(format!(
                "projection commit revision {} does not match staged {}",
                revision, staged.revision
            )));
        }
        if total_windows == 0 || total_windows > 256 {
            return Err(ProjectionError::Fatal(format!(
                "projection commit totalWindows {} exceeds budget",
                total_windows
            )));
        }
        let expected: HashSet<u32> = (0..total_windows).collect();
        let actual: HashSet<u32> = staged.windows.keys().copied().collect();
        if actual != expected {
            return Err(ProjectionError::Resync(format!(
                "projection commit missing or unexpected window indexes: expected {:?}, got {:?}",
                expected, actual
            )));
        }
        let mut cells = Vec::new();
        let mut views = Vec::new();
        for index in 0..total_windows {
            let (window_cells, window_views) = staged
                .windows
                .remove(&index)
                .expect("window set was verified");
            cells.extend(window_cells);
            views.extend(window_views);
        }
        self.publication_revision = revision;
        self.cells = cells;
        self.views = views;
        self.staged = None;
        Ok(())
    }

    pub fn discard_staged(&mut self) {
        self.staged = None;
    }
}

impl Drop for RenderModel {
    fn drop(&mut self) {
        if self.staged.is_some() {
            self.discard_staged();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(id: &str) -> Cell {
        Cell {
            id: id.into(),
            kind: "assistant_text".into(),
            lines: Vec::new(),
        }
    }

    #[test]
    fn keeps_visible_model_until_complete_commit() {
        let mut model = RenderModel::default();
        model.cells.push(cell("old"));
        model
            .stage_window(1, 0, vec![cell("new")], Vec::new(), 20)
            .unwrap();
        assert_eq!(model.cells[0].id, "old");
        model.commit(1, 1).unwrap();
        assert_eq!(model.cells[0].id, "new");
    }

    #[test]
    fn missing_window_does_not_mutate_visible_model() {
        let mut model = RenderModel::default();
        model.cells.push(cell("old"));
        model
            .stage_window(2, 1, vec![cell("new")], Vec::new(), 20)
            .unwrap();
        assert!(matches!(
            model.commit(2, 2),
            Err(ProjectionError::Resync(_))
        ));
        assert_eq!(model.cells[0].id, "old");
    }
}
