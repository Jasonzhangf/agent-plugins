use agent_memory_core::{MemoryIndexEntryDraftV1, MemoryStateSnapshot, RawKnowledge};

fn entry(id: &str, title: &str, summary: &str) -> RawKnowledge {
    RawKnowledge {
        entry_id: id.into(),
        admitted_sequence: id.parse().unwrap(),
        draft: MemoryIndexEntryDraftV1 {
            schema: "dsh.memory.index-entry.v1".into(),
            operation: "add".into(),
            target_memory_id: None,
            scope: "project".into(),
            kind: "fact".into(),
            title: title.into(),
            summary: summary.into(),
            tags: vec!["rust".into()],
            entities: vec![],
        },
        evidence_refs: vec![id.into()],
    }
}

#[test]
fn recall_is_deterministic_and_limited() {
    let mut state = MemoryStateSnapshot::empty();
    state.raw_knowledge = vec![
        entry("2", "Rust storage", "hash verification"),
        entry("1", "Rust bridge", "typed transport"),
    ];
    let hits = state.recall("rust", 1);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].entry_id, "1");
    assert_eq!(state.get_entry("2").unwrap().draft.title, "Rust storage");
}
