use agent_memory_core::{BridgeRequest, BridgeResponse, MemorySource};

#[test]
fn bridge_observation_is_typed_and_soft() {
    let request = BridgeRequest::ObserveMemory {
        output_json: "{}".into(),
        source: MemorySource {
            kind: "end-turn".into(),
            event_refs: vec!["e1".into()],
        },
    };
    let encoded = serde_json::to_string(&request).unwrap();
    let decoded: BridgeRequest = serde_json::from_str(&encoded).unwrap();
    assert!(
        matches!(decoded.dispatch(), BridgeResponse::MemoryObserved { accepted, diagnostics } if accepted.is_empty() && diagnostics.is_empty())
    );
}

#[test]
fn bridge_summary_invalid_schema_returns_diagnostic_response() {
    let response = BridgeRequest::ObserveSummary {
        summary_json: r#"{"memory":{"organized_index":{}}}"#.into(),
    }
    .dispatch();
    assert!(
        matches!(response, BridgeResponse::SummaryObserved { proposal: None, diagnostics } if diagnostics.len() == 1)
    );
}
