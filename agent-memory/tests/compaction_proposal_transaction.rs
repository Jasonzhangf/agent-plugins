use agent_memory_core::{
    organize_and_persist_with_proposal, CompressedSegment, KnowledgeStore, OrganizationProposal,
    PendingIndex, StoreError, VersionedStore,
};
use tempfile::tempdir;

#[test]
fn invalid_compaction_proposal_does_not_mutate_transaction_state() {
    let root = tempdir().unwrap();
    let mut store = VersionedStore::create(root.path(), None).unwrap();
    let mut pending = PendingIndex::new();
    let mut knowledge = KnowledgeStore::new();
    let before = store.manifest().clone();
    let proposal = OrganizationProposal {
        generation: 0,
        segments: vec![CompressedSegment {
            child_entry_ids: vec!["unknown".into()],
        }],
    };
    let error = organize_and_persist_with_proposal(
        &mut pending,
        &mut knowledge,
        &mut store,
        1,
        Some(&proposal),
    )
    .unwrap_err();
    assert!(error.contains("unknown entry"));
    assert_eq!(pending.active_len(), 0);
    assert_eq!(knowledge.raw_len(), 0);
    assert_eq!(knowledge.epoch_len(), 0);
    assert_eq!(store.manifest(), &before);
    assert!(matches!(store.load_state(), Err(StoreError::Io(_))));
}
