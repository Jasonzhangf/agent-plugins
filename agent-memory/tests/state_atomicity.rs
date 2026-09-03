use agent_memory_core::{MemoryStateSnapshot, StoreError, VersionedStore};
use std::fs;
use tempfile::tempdir;

#[test]
fn interrupted_state_commit_preserves_active_snapshot_and_manifest() {
    let root = tempdir().unwrap();
    let mut store = VersionedStore::create(root.path(), None).unwrap();
    let first = MemoryStateSnapshot::empty();
    store.save_state(&first).unwrap();
    let state_before = fs::read(root.path().join("index/state.json")).unwrap();
    let manifest_before = fs::read(root.path().join("manifest.json")).unwrap();
    let mut next = MemoryStateSnapshot::empty();
    next.next_sequence = 9;
    let error = store.save_state_with_fault(&next, true).unwrap_err();
    assert!(matches!(error, StoreError::Io(_)));
    assert_eq!(
        state_before,
        fs::read(root.path().join("index/state.json")).unwrap()
    );
    assert_eq!(
        manifest_before,
        fs::read(root.path().join("manifest.json")).unwrap()
    );
}
