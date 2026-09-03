use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

const STORE_VERSION: &str = "dsh.memory.store.v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StoreError {
    Io(String),
    Backup(String),
    Integrity(String),
    UnsupportedVersion(String),
    Serialization(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoreManifest {
    pub format_version: String,
    pub active_epoch: u64,
    pub generation_watermark: u64,
    pub files: BTreeMap<String, String>,
}

impl StoreManifest {
    pub fn new(format_version: impl Into<String>) -> Self {
        Self {
            format_version: format_version.into(),
            active_epoch: 0,
            generation_watermark: 0,
            files: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct VersionedStore {
    root: PathBuf,
    manifest: StoreManifest,
}

impl VersionedStore {
    pub fn manifest(&self) -> &StoreManifest {
        &self.manifest
    }

    pub fn save_state(&mut self, state: &MemoryStateSnapshot) -> Result<(), StoreError> {
        self.save_state_with_fault(state, false)
    }

    pub fn save_state_with_fault(
        &mut self,
        state: &MemoryStateSnapshot,
        interrupt_before_publish: bool,
    ) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec_pretty(state)
            .map_err(|e| StoreError::Serialization(e.to_string()))?;
        let relative = "index/state.json";
        let path = self.root.join(relative);
        if interrupt_before_publish {
            return Err(StoreError::Io(
                "state commit interrupted before publish".into(),
            ));
        }
        atomic_write(&path, &bytes)?;
        let mut next_manifest = self.manifest.clone();
        next_manifest.generation_watermark = state.next_sequence.saturating_sub(1);
        next_manifest.active_epoch = state.organization_epochs.len().saturating_sub(1) as u64;
        next_manifest
            .files
            .insert(relative.to_owned(), stable_hash(&bytes));
        Self::write_manifest(&self.root, &next_manifest)?;
        self.manifest = next_manifest;
        Ok(())
    }

    pub fn load_state(&self) -> Result<MemoryStateSnapshot, StoreError> {
        let bytes = fs::read(self.root.join("index/state.json")).map_err(io_err)?;
        if self.manifest.files.get("index/state.json") != Some(&stable_hash(&bytes)) {
            return Err(StoreError::Integrity(
                "index/state.json hash mismatch".into(),
            ));
        }
        serde_json::from_slice(&bytes).map_err(|e| StoreError::Serialization(e.to_string()))
    }
    pub fn create(root: &Path, backup_root: Option<&Path>) -> Result<Self, StoreError> {
        if let Some(parent) = root.parent() {
            fs::create_dir_all(parent).map_err(io_err)?;
        }
        fs::create_dir_all(root).map_err(io_err)?;
        for name in [
            "pending",
            "knowledge",
            "evidence",
            "index",
            "epochs",
            "diagnostics",
        ] {
            fs::create_dir_all(root.join(name)).map_err(io_err)?;
        }
        let manifest = StoreManifest::new(STORE_VERSION);
        Self::write_manifest(root, &manifest)?;
        let _ = backup_root;
        Ok(Self {
            root: root.to_path_buf(),
            manifest,
        })
    }
    pub fn load(root: &Path) -> Result<Self, StoreError> {
        let manifest: StoreManifest =
            serde_json::from_slice(&fs::read(root.join("manifest.json")).map_err(io_err)?)
                .map_err(|e| StoreError::Serialization(e.to_string()))?;
        if manifest.format_version != STORE_VERSION {
            return Err(StoreError::UnsupportedVersion(manifest.format_version));
        }
        verify_files(root, &manifest)?;
        Ok(Self {
            root: root.to_path_buf(),
            manifest,
        })
    }
    pub fn write_manifest(root: &Path, manifest: &StoreManifest) -> Result<(), StoreError> {
        fs::create_dir_all(root).map_err(io_err)?;
        let bytes = serde_json::to_vec_pretty(manifest)
            .map_err(|e| StoreError::Serialization(e.to_string()))?;
        atomic_write(&root.join("manifest.json"), &bytes)
    }
    pub fn migrate(
        root: &Path,
        backup_root: Option<&Path>,
        target: &str,
    ) -> Result<Self, StoreError> {
        if target != STORE_VERSION {
            return Err(StoreError::UnsupportedVersion(target.to_owned()));
        }
        let source: StoreManifest =
            serde_json::from_slice(&fs::read(root.join("manifest.json")).map_err(io_err)?)
                .map_err(|e| StoreError::Serialization(e.to_string()))?;
        if source.format_version != "dsh.memory.store.v0" {
            return Err(StoreError::UnsupportedVersion(source.format_version));
        }
        verify_files(root, &source)?;
        let backup = backup_root
            .ok_or_else(|| StoreError::Backup("backup root is required for migration".into()))?;
        if !backup.exists() {
            return Err(StoreError::Backup("backup root is unavailable".into()));
        }
        let backup_dir = backup.join(&source.format_version);
        copy_tree_read_only(root, &backup_dir).map_err(|e| StoreError::Backup(e.to_string()))?;
        let mut next = source;
        next.format_version = target.to_owned();
        let stage = root.with_extension("migration-stage");
        if stage.exists() {
            return Err(StoreError::Io("migration stage already exists".into()));
        }
        copy_tree(root, &stage).map_err(io_err)?;
        Self::write_manifest(&stage, &next)?;
        verify_files(&stage, &next)?;
        Self::write_manifest(root, &next)?;
        let _ = fs::remove_dir_all(&stage);
        Self::load(root)
    }
}

fn io_err(error: std::io::Error) -> StoreError {
    StoreError::Io(error.to_string())
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(io_err)?;
    fs::rename(&tmp, path).map_err(io_err)
}
fn verify_files(root: &Path, manifest: &StoreManifest) -> Result<(), StoreError> {
    for (relative, expected) in &manifest.files {
        let bytes = fs::read(root.join(relative)).map_err(io_err)?;
        if &stable_hash(&bytes) != expected {
            return Err(StoreError::Integrity(format!("hash mismatch: {relative}")));
        }
    }
    Ok(())
}
fn stable_hash(bytes: &[u8]) -> String {
    format!(
        "{:016x}",
        bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| (hash
            ^ u64::from(*byte))
        .wrapping_mul(0x100000001b3))
    )
}

fn stable_hash_u64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}
fn copy_tree(source: &Path, target: &Path) -> std::io::Result<()> {
    fs::create_dir_all(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        let dest = target.join(entry.file_name());
        if path.is_dir() {
            copy_tree(&path, &dest)?;
        } else {
            fs::copy(path, dest)?;
        }
    }
    Ok(())
}
fn copy_tree_read_only(source: &Path, target: &Path) -> std::io::Result<()> {
    copy_tree(source, target)?;
    for path in walk_files(target)? {
        let mut permissions = fs::metadata(&path)?.permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions)?;
    }
    Ok(())
}
fn walk_files(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            files.extend(walk_files(&path)?);
        } else {
            files.push(path);
        }
    }
    Ok(files)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemorySource {
    pub kind: String,
    pub event_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BridgeRequest {
    ObserveMemory {
        output_json: String,
        source: MemorySource,
    },
    ObserveSummary {
        summary_json: String,
    },
    Recall {
        state: MemoryStateSnapshot,
        query: String,
        limit: usize,
    },
    RecallCurrent {
        query: String,
        limit: usize,
    },
    GetCurrent {
        entry_id: String,
    },
    HistoryCurrent,
    EvidenceCurrent {
        entry_id: String,
    },
    SnapshotCurrent,
    Organize {
        mode: String,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BridgeResponse {
    MemoryObserved {
        accepted: Vec<MemoryIndexEntryDraftV1>,
        diagnostics: Vec<String>,
    },
    SummaryObserved {
        proposal: Option<OrganizationProposal>,
        diagnostics: Vec<String>,
    },
    RecallResult {
        hits: Vec<RecallHit>,
    },
    OrganizeRequested {
        mode: String,
    },
    Organized {
        mode: String,
        generation: u64,
        pending_count: usize,
        knowledge_count: usize,
    },
    EntryResult {
        entry: Option<Box<RawKnowledge>>,
    },
    HistoryResult {
        epochs: Vec<OrganizationEpoch>,
    },
    EvidenceResult {
        entry_id: String,
        evidence_refs: Vec<String>,
    },
    SnapshotResult {
        generation: u64,
        entries: Vec<RawKnowledge>,
    },
}

impl BridgeRequest {
    pub fn dispatch(self) -> BridgeResponse {
        match self {
            Self::ObserveMemory {
                output_json,
                source,
            } => {
                let observed = observe_memory(&output_json, source);
                BridgeResponse::MemoryObserved {
                    accepted: observed.accepted,
                    diagnostics: observed.diagnostic,
                }
            }
            Self::ObserveSummary { summary_json } => {
                let observed = observe_compaction_summary(&summary_json);
                BridgeResponse::SummaryObserved {
                    proposal: observed.proposal,
                    diagnostics: observed.diagnostics,
                }
            }
            Self::Recall {
                state,
                query,
                limit,
            } => BridgeResponse::RecallResult {
                hits: state.recall(&query, limit),
            },
            Self::Organize { mode } => BridgeResponse::OrganizeRequested { mode },
            Self::RecallCurrent { query, limit } => BridgeResponse::RecallResult {
                hits: MemoryStateSnapshot::empty().recall(&query, limit),
            },
            Self::GetCurrent { .. } => BridgeResponse::EntryResult { entry: None },
            Self::HistoryCurrent => BridgeResponse::HistoryResult { epochs: Vec::new() },
            Self::EvidenceCurrent { entry_id } => BridgeResponse::EvidenceResult {
                entry_id,
                evidence_refs: Vec::new(),
            },
            Self::SnapshotCurrent => BridgeResponse::SnapshotResult {
                generation: 0,
                entries: Vec::new(),
            },
        }
    }
}

/// Stateful Core-owned runtime used by the thin JSONL bridge.
pub struct MemoryRuntime {
    pending: PendingIndex,
    knowledge: KnowledgeStore,
    store: VersionedStore,
    max_index_entries: usize,
    diagnostics: Vec<String>,
}

impl MemoryRuntime {
    pub fn open(root: &Path, max_index_entries: usize) -> Result<Self, StoreError> {
        let store = if root.join("manifest.json").exists() {
            VersionedStore::load(root)?
        } else {
            VersionedStore::create(root, None)?
        };
        let mut runtime = Self {
            pending: PendingIndex::new(),
            knowledge: KnowledgeStore::new(),
            store,
            max_index_entries,
            diagnostics: Vec::new(),
        };
        if runtime
            .store
            .manifest()
            .files
            .contains_key("index/state.json")
        {
            let snapshot = runtime.store.load_state()?;
            runtime.restore(snapshot)?;
        }
        Ok(runtime)
    }

    fn restore(&mut self, snapshot: MemoryStateSnapshot) -> Result<(), StoreError> {
        self.pending.generation = snapshot.generation;
        self.pending.next_sequence = snapshot.next_sequence;
        self.pending.active = snapshot.pending;
        self.pending.content_ids.clear();
        for entry in &self.pending.active {
            let bytes = serde_json::to_vec(&entry.draft)
                .map_err(|error| StoreError::Serialization(error.to_string()))?;
            self.pending
                .content_ids
                .insert(stable_hash_u64(&bytes), entry.entry_id.clone());
        }
        for entry in &snapshot.raw_knowledge {
            let bytes = serde_json::to_vec(&entry.draft)
                .map_err(|error| StoreError::Serialization(error.to_string()))?;
            self.pending
                .content_ids
                .insert(stable_hash_u64(&bytes), entry.entry_id.clone());
        }
        self.pending.knowledge_ids = snapshot
            .raw_knowledge
            .iter()
            .map(|entry| entry.entry_id.clone())
            .collect();
        self.knowledge.raw = snapshot.raw_knowledge;
        self.knowledge.deltas = snapshot.organization_deltas;
        self.knowledge.epochs = snapshot.organization_epochs;
        self.diagnostics = snapshot.diagnostics;
        Ok(())
    }

    fn snapshot(&self) -> MemoryStateSnapshot {
        MemoryStateSnapshot {
            generation: self.pending.generation,
            next_sequence: self.pending.next_sequence,
            pending: self.pending.active.clone(),
            raw_knowledge: self.knowledge.raw.clone(),
            organization_deltas: self.knowledge.deltas.clone(),
            organization_epochs: self.knowledge.epochs.clone(),
            diagnostics: self.diagnostics.clone(),
        }
    }

    pub fn observe_memory(&mut self, output_json: &str, source: MemorySource) -> BridgeResponse {
        let observed = observe_memory(output_json, source);
        let mut diagnostics = observed.diagnostic;
        let mut accepted = Vec::new();
        for draft in observed.accepted {
            match self.pending.append(draft.clone()) {
                Ok(_) => accepted.push(draft),
                Err(error) => diagnostics.push(error),
            }
        }
        if let Err(error) = self.store.save_state(&self.snapshot()) {
            diagnostics.push(format!("state persistence failed: {error:?}"));
        }
        self.diagnostics.extend(diagnostics.iter().cloned());
        let _ = self.store.save_state(&self.snapshot());
        BridgeResponse::MemoryObserved {
            accepted,
            diagnostics,
        }
    }

    pub fn observe_summary(&mut self, summary_json: &str) -> BridgeResponse {
        let mut observed = observe_compaction_summary(summary_json);
        let root: Value = serde_json::from_str(summary_json).unwrap_or(Value::Null);
        let event_refs = root
            .get("shadowedSeqs")
            .and_then(Value::as_array)
            .map(|refs| {
                refs.iter()
                    .filter_map(|value| match value {
                        Value::String(value) => Some(value.clone()),
                        Value::Number(value) => Some(value.to_string()),
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if !event_refs.is_empty() {
            let admitted = observe_memory(
                summary_json,
                MemorySource {
                    kind: "compaction-summary".to_owned(),
                    event_refs,
                },
            );
            observed.diagnostics.extend(admitted.diagnostic);
            for draft in admitted.accepted {
                if let Err(error) = self.pending.append(draft) {
                    observed.diagnostics.push(error);
                }
            }
        }
        if let Some(proposal) = observed.proposal.as_mut() {
            if !self.pending.active.is_empty() {
                proposal.generation = self.pending.generation;
            }
        }
        if !self.pending.active.is_empty() {
            let result = organize_and_persist_with_proposal(
                &mut self.pending,
                &mut self.knowledge,
                &mut self.store,
                self.max_index_entries,
                observed.proposal.as_ref(),
            );
            if let Err(error) = result {
                self.diagnostics
                    .extend(observed.diagnostics.iter().cloned());
                return BridgeResponse::SummaryObserved {
                    proposal: None,
                    diagnostics: observed.diagnostics.into_iter().chain([error]).collect(),
                };
            }
        }
        self.diagnostics
            .extend(observed.diagnostics.iter().cloned());
        let _ = self.store.save_state(&self.snapshot());
        BridgeResponse::SummaryObserved {
            proposal: observed.proposal,
            diagnostics: observed.diagnostics,
        }
    }

    pub fn organize(&mut self, mode: String) -> BridgeResponse {
        if mode != "incremental" && mode != "full" {
            return BridgeResponse::OrganizeRequested { mode };
        }
        if !self.pending.active.is_empty() {
            if let Err(error) = organize_and_persist(
                &mut self.pending,
                &mut self.knowledge,
                &mut self.store,
                self.max_index_entries,
            ) {
                return BridgeResponse::OrganizeRequested {
                    mode: format!("{mode}: {error}"),
                };
            }
        }
        BridgeResponse::Organized {
            mode,
            generation: self.pending.generation,
            pending_count: self.pending.active_len(),
            knowledge_count: self.knowledge.raw_len(),
        }
    }

    pub fn recall(&self, query: &str, limit: usize) -> BridgeResponse {
        BridgeResponse::RecallResult {
            hits: self.snapshot().recall(query, limit),
        }
    }

    pub fn get(&self, entry_id: &str) -> BridgeResponse {
        BridgeResponse::EntryResult {
            entry: self.snapshot().get_entry(entry_id).cloned().map(Box::new),
        }
    }

    pub fn history(&self) -> BridgeResponse {
        BridgeResponse::HistoryResult {
            epochs: self.knowledge.epochs.clone(),
        }
    }

    pub fn evidence(&self, entry_id: &str) -> BridgeResponse {
        let evidence_refs = self
            .knowledge
            .raw
            .iter()
            .find(|entry| entry.entry_id == entry_id)
            .map(|entry| entry.evidence_refs.clone())
            .unwrap_or_default();
        BridgeResponse::EvidenceResult {
            entry_id: entry_id.to_owned(),
            evidence_refs,
        }
    }

    pub fn snapshot_current(&self) -> BridgeResponse {
        BridgeResponse::SnapshotResult {
            generation: self.pending.generation,
            entries: self.knowledge.raw.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MemoryIndexEntryDraftV1 {
    pub schema: String,
    pub operation: String,
    #[serde(default, rename = "targetMemoryId")]
    pub target_memory_id: Option<String>,
    pub scope: String,
    pub kind: String,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub entities: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedMemory {
    pub accepted: Vec<MemoryIndexEntryDraftV1>,
    pub diagnostic: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingIndexEntry {
    pub entry_id: String,
    pub generation: u64,
    pub admitted_sequence: u64,
    pub draft: MemoryIndexEntryDraftV1,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FrozenCut {
    pub generation: u64,
    pub watermark: u64,
    pub entries: Vec<PendingIndexEntry>,
}

#[derive(Debug, Clone, Default)]
pub struct PendingIndex {
    generation: u64,
    next_sequence: u64,
    active: Vec<PendingIndexEntry>,
    frozen: BTreeMap<u64, FrozenCut>,
    content_ids: HashMap<u64, String>,
    knowledge_ids: Vec<String>,
}

impl PendingIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn append(&mut self, draft: MemoryIndexEntryDraftV1) -> Result<PendingIndexEntry, String> {
        let bytes = serde_json::to_vec(&draft)
            .map_err(|error| format!("entry serialization failed: {error}"))?;
        let content_hash = stable_hash_u64(&bytes);
        if let Some(entry_id) = self.content_ids.get(&content_hash) {
            if let Some(existing) = self
                .active
                .iter()
                .chain(self.frozen.values().flat_map(|cut| cut.entries.iter()))
                .find(|entry| &entry.entry_id == entry_id)
            {
                return Ok(existing.clone());
            }
            if self.knowledge_ids.iter().any(|id| id == entry_id) {
                return Err("entry content already committed to knowledge".to_owned());
            }
        }
        let entry = PendingIndexEntry {
            entry_id: format!("mem-{content_hash:016x}"),
            generation: self.generation,
            admitted_sequence: self.next_sequence,
            draft,
        };
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .ok_or_else(|| "admitted sequence exhausted".to_owned())?;
        self.content_ids
            .insert(content_hash, entry.entry_id.clone());
        self.active.push(entry.clone());
        Ok(entry)
    }

    pub fn active_len(&self) -> usize {
        self.active.len()
    }

    pub fn active_entry_ids(&self) -> Vec<String> {
        self.active
            .iter()
            .map(|entry| entry.entry_id.clone())
            .collect()
    }

    pub fn knowledge_ids(&self) -> Vec<String> {
        self.knowledge_ids.clone()
    }

    pub fn freeze(&mut self) -> FrozenCut {
        let cut = FrozenCut {
            generation: self.generation,
            watermark: self.next_sequence.saturating_sub(1),
            entries: std::mem::take(&mut self.active),
        };
        self.frozen.insert(cut.generation, cut.clone());
        self.generation = self.generation.saturating_add(1);
        cut
    }

    pub fn commit_frozen(&mut self, cut: &FrozenCut) -> Result<(), String> {
        let stored = self
            .frozen
            .get(&cut.generation)
            .ok_or_else(|| "frozen generation is not available".to_owned())?;
        if stored != cut {
            return Err("frozen cut changed before commit".to_owned());
        }
        for entry in &cut.entries {
            self.knowledge_ids.push(entry.entry_id.clone());
        }
        self.frozen.remove(&cut.generation);
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RawKnowledge {
    pub entry_id: String,
    pub admitted_sequence: u64,
    pub draft: MemoryIndexEntryDraftV1,
    pub evidence_refs: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompressedSegment {
    pub child_entry_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrganizationDelta {
    pub generation: u64,
    pub entry_ids: Vec<String>,
    pub compressed_segments: Vec<CompressedSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrganizationEpoch {
    pub epoch: u64,
    pub active_entry_ids: Vec<String>,
    pub compressed_segments: Vec<CompressedSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrganizationProposal {
    pub generation: u64,
    pub segments: Vec<CompressedSegment>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
struct OrganizationProposalPayload {
    segments: Vec<CompressedSegment>,
    #[serde(default)]
    generation: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompactionObservation {
    pub proposal: Option<OrganizationProposal>,
    pub diagnostics: Vec<String>,
}

pub fn observe_compaction_summary(summary_json: &str) -> CompactionObservation {
    let root: Value = match serde_json::from_str(summary_json) {
        Ok(value) => value,
        Err(error) => {
            return CompactionObservation {
                proposal: None,
                diagnostics: vec![format!("summary JSON invalid: {error}")],
            }
        }
    };
    let Some(organized) = root
        .get("memory")
        .and_then(|memory| memory.get("organized_index"))
    else {
        return CompactionObservation {
            proposal: None,
            diagnostics: Vec::new(),
        };
    };
    match serde_json::from_value::<OrganizationProposalPayload>(organized.clone()) {
        Ok(payload) => CompactionObservation {
            proposal: Some(OrganizationProposal {
                generation: payload.generation.unwrap_or(0),
                segments: payload.segments,
            }),
            diagnostics: Vec::new(),
        },
        Err(error) => CompactionObservation {
            proposal: None,
            diagnostics: vec![format!("memory.organized_index invalid: {error}")],
        },
    }
}

pub fn validate_organization_proposal(
    cut: &FrozenCut,
    proposal: &OrganizationProposal,
) -> Result<(), String> {
    if proposal.generation != cut.generation {
        return Err("organization generation does not match frozen cut".into());
    }
    let source: BTreeSet<&str> = cut
        .entries
        .iter()
        .map(|entry| entry.entry_id.as_str())
        .collect();
    let mut referenced = BTreeSet::new();
    for segment in &proposal.segments {
        if segment.child_entry_ids.is_empty() {
            return Err("organization segment cannot be empty".into());
        }
        for id in &segment.child_entry_ids {
            if !source.contains(id.as_str()) {
                return Err(format!("organization references unknown entry: {id}"));
            }
            if !referenced.insert(id.as_str()) {
                return Err(format!(
                    "organization references entry more than once: {id}"
                ));
            }
        }
    }
    if referenced != source {
        return Err("organization does not cover every frozen entry".into());
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryStateSnapshot {
    pub generation: u64,
    pub next_sequence: u64,
    pub pending: Vec<PendingIndexEntry>,
    pub raw_knowledge: Vec<RawKnowledge>,
    pub organization_deltas: Vec<OrganizationDelta>,
    pub organization_epochs: Vec<OrganizationEpoch>,
    #[serde(default)]
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecallHit {
    pub entry_id: String,
    pub score: usize,
    pub draft: MemoryIndexEntryDraftV1,
}

impl MemoryStateSnapshot {
    pub fn recall(&self, query: &str, limit: usize) -> Vec<RecallHit> {
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|term| term.to_ascii_lowercase())
            .filter(|term| !term.is_empty())
            .collect();
        let mut hits: Vec<RecallHit> = self
            .raw_knowledge
            .iter()
            .filter_map(|entry| {
                let haystack = format!(
                    "{} {} {} {}",
                    entry.draft.title,
                    entry.draft.summary,
                    entry.draft.tags.join(" "),
                    entry.draft.entities.join(" ")
                )
                .to_ascii_lowercase();
                let score = terms
                    .iter()
                    .filter(|term| haystack.contains(term.as_str()))
                    .count();
                (score > 0).then(|| RecallHit {
                    entry_id: entry.entry_id.clone(),
                    score,
                    draft: entry.draft.clone(),
                })
            })
            .collect();
        hits.sort_by(|left, right| {
            right
                .score
                .cmp(&left.score)
                .then_with(|| left.entry_id.cmp(&right.entry_id))
        });
        hits.truncate(limit);
        hits
    }

    pub fn get_entry(&self, entry_id: &str) -> Option<&RawKnowledge> {
        self.raw_knowledge
            .iter()
            .find(|entry| entry.entry_id == entry_id)
    }
}

impl MemoryStateSnapshot {
    pub fn empty() -> Self {
        Self {
            generation: 0,
            next_sequence: 0,
            pending: Vec::new(),
            raw_knowledge: Vec::new(),
            organization_deltas: Vec::new(),
            organization_epochs: Vec::new(),
            diagnostics: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct KnowledgeStore {
    raw: Vec<RawKnowledge>,
    deltas: Vec<OrganizationDelta>,
    epochs: Vec<OrganizationEpoch>,
    last_compressed: Vec<String>,
}

impl KnowledgeStore {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn raw_len(&self) -> usize {
        self.raw.len()
    }
    pub fn delta_len(&self) -> usize {
        self.deltas.len()
    }
    pub fn epoch_len(&self) -> usize {
        self.epochs.len()
    }
    pub fn last_compressed_child_ids(&self) -> Vec<String> {
        self.last_compressed.clone()
    }

    pub fn organize_and_commit(
        &mut self,
        cut: &FrozenCut,
        max_index_entries: usize,
    ) -> Result<(), String> {
        self.organize_and_commit_with_segments(cut, max_index_entries, None, false)
    }

    /// Build the complete next state before mutating the store. `fault` models
    /// an interruption between prepare and commit and proves no partial state is published.
    pub fn organize_and_commit_with_fault(
        &mut self,
        cut: &FrozenCut,
        max_index_entries: usize,
        fault: bool,
    ) -> Result<(), String> {
        self.organize_and_commit_with_segments(cut, max_index_entries, None, fault)
    }

    fn organize_and_commit_with_segments(
        &mut self,
        cut: &FrozenCut,
        max_index_entries: usize,
        proposed_segments: Option<&[CompressedSegment]>,
        fault: bool,
    ) -> Result<(), String> {
        if self.raw.iter().any(|raw| {
            cut.entries
                .iter()
                .any(|entry| entry.entry_id == raw.entry_id)
        }) {
            return Err("frozen cut was already committed".to_owned());
        }
        let mut projected = self.raw.clone();
        projected.extend(cut.entries.iter().map(|entry| RawKnowledge {
            entry_id: entry.entry_id.clone(),
            admitted_sequence: entry.admitted_sequence,
            draft: entry.draft.clone(),
            evidence_refs: vec![entry.entry_id.clone()],
        }));
        let mut ordered = projected.clone();
        ordered.sort_by(|left, right| {
            left.admitted_sequence
                .cmp(&right.admitted_sequence)
                .then_with(|| left.entry_id.cmp(&right.entry_id))
        });
        let compression_count = if max_index_entries > 0 && ordered.len() >= max_index_entries {
            ordered.len().div_ceil(10)
        } else {
            0
        };
        let selected: Vec<String> = ordered
            .iter()
            .take(compression_count)
            .map(|raw| raw.entry_id.clone())
            .collect();
        let segments = proposed_segments.map_or_else(
            || {
                if selected.is_empty() {
                    Vec::new()
                } else {
                    vec![CompressedSegment {
                        child_entry_ids: selected.clone(),
                    }]
                }
            },
            |segments| segments.to_vec(),
        );
        let delta = OrganizationDelta {
            generation: cut.generation,
            entry_ids: cut
                .entries
                .iter()
                .map(|entry| entry.entry_id.clone())
                .collect(),
            compressed_segments: segments.clone(),
        };
        let epoch = OrganizationEpoch {
            epoch: self.epochs.len() as u64,
            active_entry_ids: projected.iter().map(|raw| raw.entry_id.clone()).collect(),
            compressed_segments: segments.clone(),
        };
        if fault {
            return Err("organization transaction interrupted before commit".to_owned());
        }
        self.raw = projected;
        self.deltas.push(delta);
        self.epochs.push(epoch);
        self.last_compressed = if proposed_segments.is_some() {
            segments
                .iter()
                .flat_map(|segment| segment.child_entry_ids.clone())
                .collect()
        } else {
            selected
        };
        Ok(())
    }

    pub fn recover(&mut self) -> Result<(), String> {
        Ok(())
    }
}

pub fn organize_and_persist(
    pending: &mut PendingIndex,
    knowledge: &mut KnowledgeStore,
    store: &mut VersionedStore,
    max_index_entries: usize,
) -> Result<(), String> {
    organize_and_persist_with_proposal(pending, knowledge, store, max_index_entries, None)
}

pub fn organize_and_persist_with_proposal(
    pending: &mut PendingIndex,
    knowledge: &mut KnowledgeStore,
    store: &mut VersionedStore,
    max_index_entries: usize,
    proposal: Option<&OrganizationProposal>,
) -> Result<(), String> {
    let mut next_pending = pending.clone();
    let mut next_knowledge = knowledge.clone();
    let cut = next_pending.freeze();
    if let Some(proposal) = proposal {
        validate_organization_proposal(&cut, proposal)?;
    }
    next_knowledge
        .organize_and_commit_with_segments(
            &cut,
            max_index_entries,
            proposal.map(|value| value.segments.as_slice()),
            false,
        )
        .map_err(|error| error.to_owned())?;
    next_pending.commit_frozen(&cut)?;
    let snapshot = MemoryStateSnapshot {
        generation: next_pending.generation,
        next_sequence: next_pending.next_sequence,
        pending: next_pending.active.clone(),
        raw_knowledge: next_knowledge.raw.clone(),
        organization_deltas: next_knowledge.deltas.clone(),
        organization_epochs: next_knowledge.epochs.clone(),
        diagnostics: Vec::new(),
    };
    store
        .save_state(&snapshot)
        .map_err(|error| format!("state persistence failed: {error:?}"))?;
    *pending = next_pending;
    *knowledge = next_knowledge;
    Ok(())
}

fn valid_enum(value: &str, allowed: &[&str]) -> bool {
    allowed.contains(&value)
}

fn validate_entry(entry: &MemoryIndexEntryDraftV1, source: &MemorySource) -> Result<(), String> {
    if entry.schema != "dsh.memory.index-entry.v1" {
        return Err("schema must be dsh.memory.index-entry.v1".to_owned());
    }
    if !valid_enum(
        &entry.operation,
        &["add", "revise", "contradict", "retract"],
    ) {
        return Err("operation is not supported".to_owned());
    }
    if !valid_enum(&entry.scope, &["task", "project", "user", "global"]) {
        return Err("scope is not supported".to_owned());
    }
    if !valid_enum(
        &entry.kind,
        &[
            "fact",
            "preference",
            "decision",
            "procedure",
            "pitfall",
            "constraint",
        ],
    ) {
        return Err("kind is not supported".to_owned());
    }
    if entry.title.trim().is_empty() || entry.summary.trim().is_empty() {
        return Err("title and summary must be non-empty".to_owned());
    }
    if entry.operation != "add"
        && entry
            .target_memory_id
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err("non-add operation requires target_memory_id".to_owned());
    }
    if source.event_refs.is_empty()
        || source
            .event_refs
            .iter()
            .any(|reference| reference.trim().is_empty())
    {
        return Err("source event refs are required".to_owned());
    }
    if source.kind == "tool-call" {
        let text = entry.summary.to_ascii_lowercase();
        let future_claim = text.contains("current tool")
            || text.contains("tool succeeded")
            || text.contains("tool result")
            || text.contains("will return");
        if future_claim {
            return Err("tool-call entry claims a future/current tool result".to_owned());
        }
    }
    Ok(())
}

/// Observe an optional model memory envelope without ever rejecting its parent output.
/// Valid entries are returned for collection; every other condition is diagnostic-only.
pub fn observe_memory(output_json: &str, source: MemorySource) -> ObservedMemory {
    let root: Value = match serde_json::from_str(output_json) {
        Ok(value) => value,
        Err(_) => {
            return ObservedMemory {
                accepted: Vec::new(),
                diagnostic: Vec::new(),
            }
        }
    };
    let Some(memory) = root.get("memory") else {
        return ObservedMemory {
            accepted: Vec::new(),
            diagnostic: Vec::new(),
        };
    };
    let Some(entries) = memory.get("entries").and_then(Value::as_array) else {
        return ObservedMemory {
            accepted: Vec::new(),
            diagnostic: vec!["memory.entries is not an array".to_owned()],
        };
    };
    let mut observed = ObservedMemory {
        accepted: Vec::new(),
        diagnostic: Vec::new(),
    };
    for (index, value) in entries.iter().enumerate() {
        match serde_json::from_value::<MemoryIndexEntryDraftV1>(value.clone()) {
            Ok(entry) => match validate_entry(&entry, &source) {
                Ok(()) => observed.accepted.push(entry),
                Err(reason) => observed
                    .diagnostic
                    .push(format!("memory.entries[{index}]: {reason}")),
            },
            Err(error) => observed
                .diagnostic
                .push(format!("memory.entries[{index}]: invalid entry: {error}")),
        }
    }
    observed
}
