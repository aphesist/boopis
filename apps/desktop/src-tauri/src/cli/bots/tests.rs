use super::*;
use crate::team::tests::{Model, base};

#[allow(clippy::struct_field_names)]
struct Out {
    code: i32,
    out: String,
    err: String,
}

async fn go(model: &Model, args: &[&str]) -> Out {
    let args: Vec<String> = args.iter().map(|s| (*s).to_owned()).collect();
    let (mut out, mut err) = (Vec::new(), Vec::new());
    let code = {
        let mut ctx = Ctx {
            backend: model,
            out: &mut out,
            err: &mut err,
        };
        bots(&args, &mut ctx).await
    };
    Out {
        code,
        out: String::from_utf8(out).unwrap(),
        err: String::from_utf8(err).unwrap(),
    }
}

#[tokio::test]
async fn a_bot_is_made_listed_and_changed() {
    let m = Model::new(base());
    let o = go(&m, &["list"]).await;
    assert_eq!(o.code, 0);
    assert!(o.out.contains("no bots yet"), "{}", o.out);
    let o = go(
        &m,
        &[
            "create", "kai", "--role", "reviews", "--model", "opus", "--shape", "circle",
            "--color", "#3a7bd5",
        ],
    )
    .await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert!(o.out.contains("made kai"));
    let o = go(&m, &["list"]).await;
    assert!(
        o.out.contains("kai  claude-sub/opus  ungoverned  reviews"),
        "{}",
        o.out
    );
    let o = go(&m, &["list", "--json"]).await;
    let v: serde_json::Value = serde_json::from_str(o.out.trim()).unwrap();
    assert_eq!(v["bots"][0]["name"], "kai");
    let o = go(&m, &["set", "kai", "--role", "writes", "--governed"]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    let o = go(&m, &["list"]).await;
    assert!(o.out.contains("governed  writes"), "{}", o.out);
    let n = m.ran().len();
    let o = go(&m, &["set", "kai", "--role", "writes"]).await;
    assert!(o.out.contains("nothing to change"), "{}", o.out);
    assert_eq!(m.ran().len(), n);
}

#[tokio::test]
async fn mistakes_are_exit_code_two_and_missing_or_existing_bots_one() {
    let m = Model::new(base());
    for args in [
        &["create"][..],
        &["create", "Bad Name"],
        &["create", "kai", "--shape", "circle"],
        &["create", "kai", "--shape", "blob", "--color", "#3a7bd5"],
        &["create", "kai", "--shape", "circle", "--color", "blue"],
        &["create", "kai", "--ungoverned"],
        &["create", "kai", "--nope"],
        &["set", "kai"],
        &["frob"],
        &[],
    ] {
        assert_eq!(go(&m, args).await.code, 2, "{args:?}");
    }
    assert!(m.ran().is_empty());
    assert_eq!(go(&m, &["set", "ghost", "--role", "x"]).await.code, 1);
    assert_eq!(go(&m, &["create", "kai"]).await.code, 0);
    assert_eq!(go(&m, &["create", "kai"]).await.code, 1);
    assert_eq!(
        go(&m, &["set", "kai", "--governed", "--ungoverned"])
            .await
            .code,
        2
    );
}

#[tokio::test]
async fn instructions_come_from_a_file() {
    let m = Model::new(base());
    let d = tempfile::tempdir().unwrap();
    let f = d.path().join("soul.md");
    std::fs::write(&f, "Be brief.\n").unwrap();
    let o = go(&m, &["create", "kai", "--soul-file", f.to_str().unwrap()]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert_eq!(m.now.lock().unwrap().bots["kai"].soul, "Be brief.\n");
    assert_eq!(
        go(&m, &["create", "nina", "--soul-file", "/nonexistent/x"])
            .await
            .code,
        2
    );
}

#[tokio::test]
async fn a_bots_cap_on_turns_is_made_changed_and_taken_back_to_the_default() {
    let m = Model::new(base());
    let o = go(&m, &["create", "kai", "--max-turns", "30"]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    let json = |o: &Out| serde_json::from_str::<serde_json::Value>(o.out.trim()).unwrap();
    let o = go(&m, &["list", "--json"]).await;
    assert_eq!(json(&o)["bots"][0]["max_turns"], 30);
    assert_eq!(json(&o)["bots"][0]["default_max_turns"], 10);
    // only a difference is sent
    let n = m.ran().len();
    let o = go(&m, &["set", "kai", "--max-turns", "30"]).await;
    assert!(o.out.contains("nothing to change"), "{}", o.out);
    assert_eq!(m.ran().len(), n);
    let o = go(&m, &["set", "kai", "--max-turns", "5"]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert_eq!(m.read_turns("kai"), Some(5));
    // the way back
    let o = go(&m, &["set", "kai", "--max-turns", "default"]).await;
    assert_eq!(o.code, 0, "{}{}", o.out, o.err);
    assert_eq!(m.read_turns("kai"), None);
    let n = m.ran().len();
    assert!(
        go(&m, &["set", "kai", "--max-turns", "default"])
            .await
            .out
            .contains("nothing to change")
    );
    assert_eq!(m.ran().len(), n);
    // a number out of range, or not a number, is a usage mistake and asks nothing
    for bad in ["0", "5000", "many", "-2"] {
        assert_eq!(
            go(&m, &["set", "kai", "--max-turns", bad]).await.code,
            2,
            "{bad}"
        );
        assert_eq!(
            go(&m, &["create", "nina", "--max-turns", bad]).await.code,
            2,
            "{bad}"
        );
    }
    assert_eq!(m.ran().len(), n);
}
