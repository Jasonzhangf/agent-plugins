use agent_memory_core::{KnowledgeStore, MemoryIndexEntryDraftV1, PendingIndex};

fn entry(title: &str) -> MemoryIndexEntryDraftV1 {
    MemoryIndexEntryDraftV1 {
        schema: "dsh.memory.index-entry.v1".into(),
        operation: "add".into(),
        target_memory_id: None,
        scope: "project".into(),
        kind: "fact".into(),
        title: title.into(),
        summary: format!("summary {title}"),
        tags: vec!["tag".into()],
        entities: vec![],
    }
}

fn cut(count: usize) -> agent_memory_core::FrozenCut {
    let mut pending = PendingIndex::new();
    for index in 0..count {
        pending.append(entry(&format!("e{index}"))).unwrap();
    }
    pending.freeze()
}

#[test]
fn raw_and_delta_commit_together() {
    let mut store = KnowledgeStore::new();
    let frozen = cut(2);
    store.organize_and_commit(&frozen, 10).unwrap();
    assert_eq!(store.raw_len(), 2);
    assert_eq!(store.delta_len(), 1);
    assert_eq!(store.epoch_len(), 1);
}

#[test]
fn oldest_ten_percent_is_deterministic_and_referenced() {
    let mut store = KnowledgeStore::new();
    let frozen = cut(10);
    store.organize_and_commit(&frozen, 5).unwrap();
    let selected = store.last_compressed_child_ids();
    assert_eq!(selected.len(), 1);
    assert_eq!(selected[0], frozen.entries[0].entry_id);
}

#[test]
fn failed_transaction_does_not_publish_partial_state_and_recovers() {
    let mut store = KnowledgeStore::new();
    let frozen = cut(3);
    assert!(store
        .organize_and_commit_with_fault(&frozen, 2, true)
        .is_err());
    assert_eq!(
        (store.raw_len(), store.delta_len(), store.epoch_len()),
        (0, 0, 0)
    );
    store.recover().unwrap();
    assert_eq!(
        (store.raw_len(), store.delta_len(), store.epoch_len()),
        (0, 0, 0)
    );
    store.organize_and_commit(&frozen, 2).unwrap();
    assert_eq!(store.raw_len(), 3);
}
