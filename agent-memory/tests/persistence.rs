use agent_memory_core::{StoreError, StoreManifest, VersionedStore};
use std::fs;
use tempfile::tempdir;

#[test]
fn create_writes_versioned_manifest_under_selected_root() {
    let root = tempdir().unwrap();
    let store = VersionedStore::create(root.path(), None).unwrap();
    assert_eq!(store.manifest().format_version, "dsh.memory.store.v1");
    assert!(root.path().join("manifest.json").is_file());
    for name in [
        "pending",
        "knowledge",
        "evidence",
        "index",
        "epochs",
        "diagnostics",
    ] {
        assert!(root.path().join(name).is_dir(), "missing {name}");
    }
}

#[test]
fn backup_failure_does_not_change_active_manifest() {
    let root = tempdir().unwrap();
    let old = StoreManifest::new("dsh.memory.store.v0");
    VersionedStore::write_manifest(root.path(), &old).unwrap();
    let before = fs::read(root.path().join("manifest.json")).unwrap();
    let unavailable = root.path().join("missing").join("backup");
    let error = VersionedStore::migrate(root.path(), Some(&unavailable), "dsh.memory.store.v1")
        .unwrap_err();
    assert!(matches!(error, StoreError::Backup(_)));
    assert_eq!(before, fs::read(root.path().join("manifest.json")).unwrap());
}

#[test]
fn migration_keeps_read_only_backup_and_activates_new_manifest() {
    let root = tempdir().unwrap();
    let backup = tempdir().unwrap();
    let old = StoreManifest::new("dsh.memory.store.v0");
    VersionedStore::write_manifest(root.path(), &old).unwrap();
    let store =
        VersionedStore::migrate(root.path(), Some(backup.path()), "dsh.memory.store.v1").unwrap();
    assert_eq!(store.manifest().format_version, "dsh.memory.store.v1");
    assert!(backup
        .path()
        .join("dsh.memory.store.v0")
        .join("manifest.json")
        .is_file());
    assert!(backup
        .path()
        .join("dsh.memory.store.v0")
        .join("manifest.json")
        .metadata()
        .unwrap()
        .permissions()
        .readonly());
    assert_eq!(
        VersionedStore::load(root.path())
            .unwrap()
            .manifest()
            .format_version,
        "dsh.memory.store.v1"
    );
}

#[test]
fn hash_mismatch_never_activates_migration() {
    let root = tempdir().unwrap();
    let backup = tempdir().unwrap();
    let mut old = StoreManifest::new("dsh.memory.store.v0");
    old.files.insert("knowledge/a.json".into(), "wrong".into());
    VersionedStore::write_manifest(root.path(), &old).unwrap();
    fs::create_dir_all(root.path().join("knowledge")).unwrap();
    fs::write(root.path().join("knowledge/a.json"), b"actual").unwrap();
    let before = fs::read(root.path().join("manifest.json")).unwrap();
    let error = VersionedStore::migrate(root.path(), Some(backup.path()), "dsh.memory.store.v1")
        .unwrap_err();
    assert!(matches!(error, StoreError::Integrity(_)));
    assert_eq!(before, fs::read(root.path().join("manifest.json")).unwrap());
}

#[test]
fn unsupported_version_is_explicit_error() {
    let root = tempdir().unwrap();
    let mut manifest = StoreManifest::new("dsh.memory.store.v9");
    VersionedStore::write_manifest(root.path(), &manifest).unwrap();
    let error = VersionedStore::migrate(root.path(), None, "dsh.memory.store.v1").unwrap_err();
    assert!(matches!(error, StoreError::UnsupportedVersion(_)));
    manifest.format_version = "dsh.memory.store.v1".into();
}

#[test]
fn unsupported_target_is_rejected_before_migration() {
    let root = tempdir().unwrap();
    let backup = tempdir().unwrap();
    let old = StoreManifest::new("dsh.memory.store.v0");
    VersionedStore::write_manifest(root.path(), &old).unwrap();
    let before = fs::read(root.path().join("manifest.json")).unwrap();
    let error = VersionedStore::migrate(root.path(), Some(backup.path()), "dsh.memory.store.v2")
        .unwrap_err();
    assert!(matches!(error, StoreError::UnsupportedVersion(_)));
    assert_eq!(before, fs::read(root.path().join("manifest.json")).unwrap());
}
