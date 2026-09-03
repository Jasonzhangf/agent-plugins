use agent_memory_core::{MemoryIndexEntryDraftV1, PendingIndex};

fn entry(title: &str) -> MemoryIndexEntryDraftV1 {
    MemoryIndexEntryDraftV1 {
        schema: "dsh.memory.index-entry.v1".into(),
        operation: "add".into(),
        target_memory_id: None,
        scope: "project".into(),
        kind: "fact".into(),
        title: title.into(),
        summary: format!("summary for {title}"),
        tags: vec!["test".into()],
        entities: vec!["dsh-memory".into()],
    }
}

#[test]
fn dedupe_does_not_duplicate_pending_entries() {
    let mut index = PendingIndex::new();
    let first = index.append(entry("same")).unwrap();
    let second = index.append(entry("same")).unwrap();
    assert_eq!(first.entry_id, second.entry_id);
    assert_eq!(index.active_len(), 1);
}

#[test]
fn freeze_isolates_generation_and_watermark() {
    let mut index = PendingIndex::new();
    index.append(entry("before")).unwrap();
    let cut = index.freeze();
    let later = index.append(entry("after")).unwrap();
    assert_eq!(cut.generation, 0);
    assert_eq!(cut.entries.len(), 1);
    assert_eq!(later.generation, 1);
    assert_eq!(index.active_len(), 1);
}

#[test]
fn uncommitted_pending_entries_never_appear_in_knowledge() {
    let mut index = PendingIndex::new();
    index.append(entry("not committed")).unwrap();
    assert!(index.knowledge_ids().is_empty());
}

#[test]
fn commit_moves_only_frozen_cut_and_preserves_new_generation() {
    let mut index = PendingIndex::new();
    index.append(entry("old")).unwrap();
    let cut = index.freeze();
    let later = index.append(entry("new")).unwrap();
    index.commit_frozen(&cut).unwrap();
    assert_eq!(index.knowledge_ids(), vec![cut.entries[0].entry_id.clone()]);
    assert_eq!(index.active_len(), 1);
    assert_eq!(index.active_entry_ids(), vec![later.entry_id]);
}
