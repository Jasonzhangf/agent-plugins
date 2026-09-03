use agent_memory_core::observe_compaction_summary;

#[test]
fn missing_or_invalid_organized_index_is_soft_diagnostic() {
    assert!(observe_compaction_summary(r#"{"summary":"ok"}"#)
        .proposal
        .is_none());
    let invalid = observe_compaction_summary(r#"{"memory":{"organized_index":{"generation":1}}}"#);
    assert!(invalid.proposal.is_none());
    assert_eq!(invalid.diagnostics.len(), 1);
}

#[test]
fn valid_organized_index_is_returned_as_typed_proposal() {
    let observed = observe_compaction_summary(
        r#"{"memory":{"organized_index":{"generation":4,"segments":[{"child_entry_ids":["a"]}]}}}"#,
    );
    assert_eq!(observed.proposal.unwrap().generation, 4);
    assert!(observed.diagnostics.is_empty());
}
