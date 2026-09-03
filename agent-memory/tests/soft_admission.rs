use agent_memory_core::{observe_memory, MemorySource};

fn source(kind: &str) -> MemorySource {
    MemorySource {
        kind: kind.to_owned(),
        event_refs: vec!["event-1".to_owned()],
    }
}

#[test]
fn missing_memory_never_rejects_parent_output() {
    let observed = observe_memory(r#"{"text":"ordinary output"}"#, source("end-turn"));
    assert!(observed.accepted.is_empty());
    assert!(observed.diagnostic.is_empty());
}

#[test]
fn valid_entries_are_collected_from_tool_call() {
    let observed = observe_memory(
        r#"{"memory":{"entries":[{"schema":"dsh.memory.index-entry.v1","operation":"add","scope":"project","kind":"fact","title":"Build command","summary":"cargo test passes","tags":["build"],"entities":["dsh-memory"]}]}}"#,
        source("tool-call"),
    );
    assert_eq!(observed.accepted.len(), 1);
    assert_eq!(observed.accepted[0].title, "Build command");
}

#[test]
fn end_turn_uses_the_same_collection_contract() {
    let observed = observe_memory(
        r#"{"memory":{"entries":[{"schema":"dsh.memory.index-entry.v1","operation":"add","scope":"user","kind":"preference","title":"Language","summary":"Prefer concise Chinese replies","tags":["preference"],"entities":[]}]}}"#,
        source("end-turn"),
    );
    assert_eq!(observed.accepted.len(), 1);
    assert_eq!(observed.accepted[0].scope, "user");
}

#[test]
fn malformed_memory_does_not_block_parent_and_is_diagnostic_only() {
    let observed = observe_memory(
        r#"{"memory":{"entries":[{"schema":"wrong","operation":"add"}]}}"#,
        source("end-turn"),
    );
    assert!(observed.accepted.is_empty());
    assert!(!observed.diagnostic.is_empty());
}

#[test]
fn future_tool_result_claim_is_not_collected() {
    let observed = observe_memory(
        r#"{"memory":{"entries":[{"schema":"dsh.memory.index-entry.v1","operation":"add","scope":"task","kind":"fact","title":"Future","summary":"the current tool succeeded","tags":[],"entities":[]}]}}"#,
        source("tool-call"),
    );
    assert!(observed.accepted.is_empty());
    assert!(observed.diagnostic.iter().any(|d| d.contains("tool-call")));
}
