use agent_memory_core::{
    BridgeResponse, MemoryIndexEntryDraftV1, MemoryRuntime, MemorySource, MemoryStateSnapshot,
    RawKnowledge, StoreError, VersionedStore,
};
use std::fs;
use tempfile::tempdir;

#[test]
fn state_round_trip_updates_manifest_hash() {
    let root = tempdir().unwrap();
    let mut store = VersionedStore::create(root.path(), None).unwrap();
    let state = MemoryStateSnapshot::empty();
    store.save_state(&state).unwrap();
    assert!(store.manifest().files.contains_key("index/state.json"));
    assert_eq!(store.load_state().unwrap(), state);
    assert_eq!(
        VersionedStore::load(root.path())
            .unwrap()
            .load_state()
            .unwrap(),
        state
    );
}

#[test]
fn tampered_state_is_rejected_without_reconstructing_truth() {
    let root = tempdir().unwrap();
    let mut store = VersionedStore::create(root.path(), None).unwrap();
    store.save_state(&MemoryStateSnapshot::empty()).unwrap();
    fs::write(root.path().join("index/state.json"), b"{}").unwrap();
    assert!(matches!(store.load_state(), Err(StoreError::Integrity(_))));
    assert!(matches!(
        VersionedStore::load(root.path()),
        Err(StoreError::Integrity(_))
    ));
}

#[test]
fn reopened_runtime_deduplicates_content_already_in_knowledge() {
    let root = tempdir().unwrap();
    let payload = r#"{"memory":{"entries":[{"schema":"dsh.memory.index-entry.v1","operation":"add","scope":"project","kind":"fact","title":"Fixture","summary":"same","tags":[],"entities":[]}]}}"#;
    let source = MemorySource {
        kind: "tool-call".into(),
        event_refs: vec!["e1".into()],
    };
    let mut runtime = MemoryRuntime::open(root.path(), 100).unwrap();
    assert!(
        matches!(runtime.observe_memory(payload, source.clone()), BridgeResponse::MemoryObserved { accepted, .. } if accepted.len() == 1)
    );
    assert!(matches!(
        runtime.organize("incremental".into()),
        BridgeResponse::Organized {
            knowledge_count: 1,
            ..
        }
    ));
    drop(runtime);

    let mut reopened = MemoryRuntime::open(root.path(), 100).unwrap();
    assert!(
        matches!(reopened.observe_memory(payload, source), BridgeResponse::MemoryObserved { accepted, diagnostics } if accepted.is_empty() && diagnostics.iter().any(|item| item.contains("already committed")))
    );
    assert!(
        matches!(reopened.snapshot_current(), BridgeResponse::SnapshotResult { entries, .. } if entries.len() == 1)
    );
}

#[test]
fn migrated_legacy_random_entry_id_still_deduplicates_by_content() {
    let root = tempdir().unwrap();
    let backup = tempdir().unwrap();
    let mut store = VersionedStore::create(root.path(), None).unwrap();
    let draft = MemoryIndexEntryDraftV1 {
        schema: "dsh.memory.index-entry.v1".into(),
        operation: "add".into(),
        target_memory_id: None,
        scope: "project".into(),
        kind: "fact".into(),
        title: "Legacy fixture".into(),
        summary: "stable content".into(),
        tags: vec!["migration".into()],
        entities: vec![],
    };
    store
        .save_state(&MemoryStateSnapshot {
            generation: 1,
            next_sequence: 2,
            pending: vec![],
            raw_knowledge: vec![RawKnowledge {
                entry_id: "legacy-random-hash-id".into(),
                admitted_sequence: 1,
                draft: draft.clone(),
                evidence_refs: vec!["e1".into()],
            }],
            organization_deltas: vec![],
            organization_epochs: vec![],
            diagnostics: vec![],
        })
        .unwrap();
    let mut legacy = store.manifest().clone();
    legacy.format_version = "dsh.memory.store.v0".into();
    VersionedStore::write_manifest(root.path(), &legacy).unwrap();

    VersionedStore::migrate(root.path(), Some(backup.path()), "dsh.memory.store.v1").unwrap();
    let mut runtime = MemoryRuntime::open(root.path(), 100).unwrap();
    let payload = serde_json::json!({"memory": {"entries": [draft]}}).to_string();
    assert!(matches!(
        runtime.observe_memory(
            &payload,
            MemorySource { kind: "tool-call".into(), event_refs: vec!["e2".into()] }
        ),
        BridgeResponse::MemoryObserved { accepted, diagnostics }
            if accepted.is_empty() && diagnostics.iter().any(|item| item.contains("already committed"))
    ));
}

#[test]
fn invalid_memory_diagnostic_survives_reopen() {
    let root = tempdir().unwrap();
    let mut runtime = MemoryRuntime::open(root.path(), 100).unwrap();
    let response = runtime.observe_memory(
        r#"{"memory":{"entries":[{"schema":"wrong"}]}}"#,
        MemorySource {
            kind: "tool-call".into(),
            event_refs: vec!["e1".into()],
        },
    );
    assert!(
        matches!(response, BridgeResponse::MemoryObserved { accepted, diagnostics } if accepted.is_empty() && !diagnostics.is_empty())
    );
    drop(runtime);

    let state = VersionedStore::load(root.path())
        .unwrap()
        .load_state()
        .unwrap();
    assert!(!state.diagnostics.is_empty());
    assert!(state.diagnostics[0].contains("memory.entries[0]"));
}

#[test]
fn runtime_capacity_organization_persists_oldest_ten_percent_segment() {
    let root = tempdir().unwrap();
    let mut runtime = MemoryRuntime::open(root.path(), 3).unwrap();
    for (index, title) in ["one", "two", "three"].into_iter().enumerate() {
        let payload = format!(
            "{{\"memory\":{{\"entries\":[{{\"schema\":\"dsh.memory.index-entry.v1\",\"operation\":\"add\",\"scope\":\"project\",\"kind\":\"fact\",\"title\":\"{title}\",\"summary\":\"summary {title}\",\"tags\":[],\"entities\":[]}}]}}}}"
        );
        assert!(matches!(
            runtime.observe_memory(
                &payload,
                MemorySource { kind: "end-turn".into(), event_refs: vec![format!("e{index}")] }
            ),
            BridgeResponse::MemoryObserved { accepted, diagnostics } if accepted.len() == 1 && diagnostics.is_empty()
        ));
    }
    assert!(matches!(
        runtime.organize("incremental".into()),
        BridgeResponse::Organized {
            knowledge_count: 3,
            ..
        }
    ));
    let state = VersionedStore::load(root.path())
        .unwrap()
        .load_state()
        .unwrap();
    assert_eq!(state.raw_knowledge.len(), 3);
    assert_eq!(state.organization_deltas.len(), 1);
    assert_eq!(state.organization_deltas[0].compressed_segments.len(), 1);
    assert_eq!(
        state.organization_deltas[0].compressed_segments[0]
            .child_entry_ids
            .len(),
        1
    );
    assert_eq!(state.organization_epochs[0].compressed_segments.len(), 1);
}
