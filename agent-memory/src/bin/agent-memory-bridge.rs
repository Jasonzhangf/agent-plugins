use agent_memory_core::{BridgeRequest, BridgeResponse, MemoryRuntime};
use std::env;
use std::io::{self, BufRead, Write};
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = env::var_os("AGENT_MEMORY_ROOT")
        .map(PathBuf::from)
        .ok_or("AGENT_MEMORY_ROOT is required")?;
    let max_index_entries = env::var("AGENT_MEMORY_MAX_INDEX_ENTRIES")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1000);
    let mut runtime = MemoryRuntime::open(&root, max_index_entries)
        .map_err(|error| format!("memory runtime open failed: {error:?}"))?;
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<BridgeRequest>(&line) {
            Ok(BridgeRequest::ObserveMemory {
                output_json,
                source,
            }) => runtime.observe_memory(&output_json, source),
            Ok(BridgeRequest::ObserveSummary { summary_json }) => {
                runtime.observe_summary(&summary_json)
            }
            Ok(BridgeRequest::Recall { query, limit, .. }) => runtime.recall(&query, limit),
            Ok(BridgeRequest::RecallCurrent { query, limit }) => runtime.recall(&query, limit),
            Ok(BridgeRequest::GetCurrent { entry_id }) => runtime.get(&entry_id),
            Ok(BridgeRequest::HistoryCurrent) => runtime.history(),
            Ok(BridgeRequest::EvidenceCurrent { entry_id }) => runtime.evidence(&entry_id),
            Ok(BridgeRequest::SnapshotCurrent) => runtime.snapshot_current(),
            Ok(BridgeRequest::Organize { mode }) => runtime.organize(mode),
            Err(error) => BridgeResponse::OrganizeRequested {
                mode: format!("invalid request: {error}"),
            },
        };
        serde_json::to_writer(&mut stdout, &response)?;
        stdout.write_all(b"\n")?;
        stdout.flush()?;
    }
    Ok(())
}
