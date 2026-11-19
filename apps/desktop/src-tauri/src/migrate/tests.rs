use super::*;
use crate::secrets::store::MemoryStore;

const CONFIG: &str = "plugins:\n  enabled:\n    - hypotaxis\n  entries:\n    hypotaxis:\n      settings:\n        hx_path: /data/dev.aphesist.hypotaxis/hermes-home/hypotaxis/bin/hx\nsecrets:\n  hypotaxis_host:\n    enabled: true\n    env:\n      HYPOTAXIS_PROVIDER_MAIN_API_KEY_C72E2A4F: secret://provider.main/api_key\n";

fn old_tree(root: &Path) -> PathBuf {
    let home = root.join(OLD_ID).join(HOME_DIR);
    fs::create_dir_all(home.join(OLD_WORD).join("ledger")).unwrap();
    fs::write(home.join(OLD_WORD).join("ledger").join("s.jsonl"), "{}\n").unwrap();
    fs::create_dir_all(home.join("logs").join(OLD_WORD)).unwrap();
    fs::create_dir_all(home.join("plugins").join(OLD_WORD)).unwrap();
    fs::create_dir_all(home.join("plugins").join("other")).unwrap();
    fs::write(home.join("config.yaml"), CONFIG).unwrap();
    fs::write(root.join(OLD_ID).join("settings.json"), "{}").unwrap();
    home
}

#[test]
fn the_app_folder_and_the_private_home_move_once() {
    let tmp = tempfile::tempdir().unwrap();
    old_tree(tmp.path());
    let report = folders(&[tmp.path().to_owned()]);
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);
    assert_eq!(report.moved.len(), 1);
    let new = tmp.path().join(NEW_ID);
    assert!(!tmp.path().join(OLD_ID).exists());
    assert!(new.join("settings.json").is_file());
    let home = new.join(HOME_DIR);
    assert!(home.join("boopis/ledger/s.jsonl").is_file());
    assert!(home.join("logs/boopis").is_dir());
    assert!(!home.join("plugins/hypotaxis").exists());
    assert!(
        home.join("plugins/other").is_dir(),
        "another plugin is not ours to remove"
    );
    let config = fs::read_to_string(home.join("config.yaml")).unwrap();
    assert!(
        !config.to_ascii_lowercase().contains("hypotaxis"),
        "{config}"
    );
    assert!(
        config.contains("BOOPIS_PROVIDER_MAIN_API_KEY_C72E2A4F: secret://provider.main/api_key")
    );
    assert!(config.contains("/data/dev.aphesist.boopis/hermes-home/boopis/bin/hx"));
    assert_eq!(report.refs, vec![SecretRef::provider_key("main")]);
    assert!(!home.join("config.yaml.migrating").exists());

    let again = folders(&[tmp.path().to_owned()]);
    assert!(
        again.is_empty(),
        "a second run finds nothing to do: {again:?}"
    );
}

#[test]
fn two_folders_with_both_names_are_left_alone() {
    let tmp = tempfile::tempdir().unwrap();
    old_tree(tmp.path());
    fs::create_dir_all(tmp.path().join(NEW_ID)).unwrap();
    let report = folders(&[tmp.path().to_owned()]);
    assert!(report.moved.is_empty());
    assert_eq!(report.warnings.len(), 1);
    assert!(tmp.path().join(OLD_ID).join("settings.json").is_file());
}

#[test]
fn a_machine_without_the_old_folder_is_untouched() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(folders(&[tmp.path().to_owned(), tmp.path().join("missing")]).is_empty());
}

#[test]
fn references_are_read_once_and_only_when_valid() {
    let text = "a: secret://provider.main/api_key\nb: 'secret://provider.main/api_key'\nc: secret://Bad/x\nd: secret://host.api.example.com/token\n";
    let refs = references(text);
    assert_eq!(refs.len(), 2);
    assert_eq!(refs[1].scope, "host.api.example.com");
}

#[test]
fn keys_move_to_the_new_service_name_and_the_old_entry_goes() {
    let store = MemoryStore::default();
    store
        .set("hypotaxis.provider.main", "api_key", "sk-1")
        .unwrap();
    let refs = [
        SecretRef::provider_key("main"),
        SecretRef::provider_key("none"),
    ];
    let report = keychain(&store, &refs);
    assert_eq!(
        report.moved,
        vec!["secret://provider.main/api_key".to_owned()]
    );
    assert!(report.warnings.is_empty());
    assert_eq!(
        store
            .get("boopis.provider.main", "api_key")
            .unwrap()
            .as_deref(),
        Some("sk-1")
    );
    assert_eq!(
        store.get("hypotaxis.provider.main", "api_key").unwrap(),
        None
    );
    assert_eq!(
        keychain(&store, &refs),
        KeychainReport::default(),
        "a second run moves nothing"
    );
}

#[test]
fn an_existing_new_key_wins_and_the_old_one_stays() {
    let store = MemoryStore::default();
    store
        .set("hypotaxis.provider.main", "api_key", "old")
        .unwrap();
    store.set("boopis.provider.main", "api_key", "new").unwrap();
    let report = keychain(&store, &[SecretRef::provider_key("main")]);
    assert!(report.moved.is_empty());
    assert_eq!(report.warnings.len(), 1);
    assert_eq!(
        store
            .get("boopis.provider.main", "api_key")
            .unwrap()
            .as_deref(),
        Some("new")
    );
    assert_eq!(
        store
            .get("hypotaxis.provider.main", "api_key")
            .unwrap()
            .as_deref(),
        Some("old")
    );
}

#[test]
fn an_unavailable_keychain_stops_the_step_with_one_warning() {
    let store = MemoryStore::default();
    store
        .unavailable
        .store(true, std::sync::atomic::Ordering::Relaxed);
    let report = keychain(
        &store,
        &[SecretRef::provider_key("a"), SecretRef::provider_key("b")],
    );
    assert_eq!(report.warnings.len(), 1);
    assert!(report.moved.is_empty());
}
