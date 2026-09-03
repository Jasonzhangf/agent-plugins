use agent_memory_core::{
    validate_organization_proposal, CompressedSegment, FrozenCut, MemoryIndexEntryDraftV1,
    OrganizationProposal,
};

fn cut() -> FrozenCut {
    FrozenCut {
        generation: 3,
        watermark: 2,
        entries: vec!["a", "b"]
            .into_iter()
            .map(|id| agent_memory_core::PendingIndexEntry {
                entry_id: id.into(),
                generation: 3,
                admitted_sequence: 0,
                draft: MemoryIndexEntryDraftV1 {
                    schema: "dsh.memory.index-entry.v1".into(),
                    operation: "add".into(),
                    target_memory_id: None,
                    scope: "project".into(),
                    kind: "fact".into(),
                    title: "t".into(),
                    summary: "s".into(),
                    tags: vec![],
                    entities: vec![],
                },
            })
            .collect(),
    }
}

#[test]
fn proposal_requires_exact_frozen_cut_coverage() {
    let result = validate_organization_proposal(
        &cut(),
        &OrganizationProposal {
            generation: 3,
            segments: vec![
                CompressedSegment {
                    child_entry_ids: vec!["a".into()],
                },
                CompressedSegment {
                    child_entry_ids: vec!["b".into()],
                },
            ],
        },
    );
    assert!(result.is_ok());
}

#[test]
fn proposal_rejects_unknown_or_duplicate_entries() {
    let unknown = validate_organization_proposal(
        &cut(),
        &OrganizationProposal {
            generation: 3,
            segments: vec![CompressedSegment {
                child_entry_ids: vec!["a".into(), "x".into()],
            }],
        },
    );
    assert!(unknown.is_err());
    let duplicate = validate_organization_proposal(
        &cut(),
        &OrganizationProposal {
            generation: 3,
            segments: vec![CompressedSegment {
                child_entry_ids: vec!["a".into(), "a".into(), "b".into()],
            }],
        },
    );
    assert!(duplicate.is_err());
}
