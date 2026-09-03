use agent_memory_core::{
    organize_and_persist, KnowledgeStore, MemoryStateSnapshot, PendingIndex, VersionedStore,
};
use tempfile::tempdir;

#[test]
fn organization_transaction_persists_and_commits_both_domains() {
    let root = tempdir().unwrap();
    let mut store = VersionedStore::create(root.path(), None).unwrap();
    let mut pending = PendingIndex::new();
    let mut knowledge = KnowledgeStore::new();
    let result = organize_and_persist(&mut pending, &mut knowledge, &mut store, 1);
    assert!(result.is_ok());
    assert_eq!(pending.active_len(), 0);
    assert_eq!(knowledge.epoch_len(), 1);
    assert_eq!(
        store.load_state().unwrap(),
        MemoryStateSnapshot {
            generation: 1,
            next_sequence: 0,
            pending: vec![],
            raw_knowledge: vec![],
            organization_deltas: vec![agent_memory_core::OrganizationDelta {
                generation: 0,
                entry_ids: vec![],
                compressed_segments: vec![]
            }],
            organization_epochs: vec![agent_memory_core::OrganizationEpoch {
                epoch: 0,
                active_entry_ids: vec![],
                compressed_segments: vec![]
            }],
            diagnostics: vec![],
        }
    );
}
