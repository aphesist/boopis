//! A bot's model, set so that what is reported is what happened: which providers and models the bot can reach (checked before
//! anything is written), what the engine did not save, and the model read back afterwards. The one way a bot's model is set:
//! `boopis bots`, `team apply` and the app's Bots page (`bots_set_model`, through `engine::Service::set_model`) all come here.
//!
//! What a bot can reach is read from `model.options` in the bot's own scope: the inventory the app's model picker reads
//! (`ui/src/host/live/bots.ts`, `readModels`: a provider row counts unless it says `authenticated: false`), asked with the
//! bot's name, which the engine binds to the bot's home, sign-ins and secrets. A provider is listed there only when its plugin
//! is loaded in the bot's home and the sign-in or key it needs is found, and its row carries its catalogue. So a model the bot
//! can reach is: a provider in that list, and, where the row has a catalogue, a model in it (an alias counts as the model it
//! points at today, `model_names::same`, as the picker counts it).
//!
//! The calls go over a link to the root's gateway (`Rpc`): `model.options` with the bot's name, which the engine binds to the
//! bot's scope, `profiles.configure` and `profiles.describe`. The command line passes the link it keeps; the app, which keeps
//! none outside its windows, passes [`RootLink`] (a short link per call, the engine's `call`).
//!
//! An alias the provider floats itself (the Claude subscription's `haiku`) is kept as it was written. The engine pins it to the
//! id it names today (`claude-haiku-5-5[1m]`), which would stop the bot following the newest model of its tier and set it apart
//! from the main profile, the team file and the app's picker, which all write the alias: `team apply` of an exported file then
//! found a change it could never make (B34). Treating the two spellings as equal in the plan instead would keep two
//! representations on disk and hide a real difference (an alias moves, a pinned id does not), so the alias is written back.

use std::path::Path;

use async_trait::async_trait;
use serde_json::{Value, json};

use crate::bots;
use crate::error::{self, Error};
use crate::model_names;
use crate::rooms::Rpc;

/// One provider row of `model.options`.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Provider {
    /// Its slug, as a model names it (`claude-subscription-directsdk-experimental/opus`).
    pub slug: String,
    /// Other spellings the engine accepts for it (a provider of the user's own).
    pub aliases: Vec<String>,
    /// `false` when the engine lists it without a sign-in or a key it can use.
    pub signed_in: bool,
    /// Its catalogue; empty when it has none to offer (the engine then judges a model alone).
    pub models: Vec<String>,
    /// Models it lists that this account may not use.
    pub unavailable: Vec<String>,
}

/// What one bot can reach.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Reach {
    /// The rows, in the engine's order.
    pub providers: Vec<Provider>,
}

fn strings(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// At most `n` names, then how many more.
fn some_of(names: &[String], n: usize) -> String {
    if names.len() > n {
        format!("{} and {} more", names[..n].join(", "), names.len() - n)
    } else {
        bots::and_list(names)
    }
}

impl Reach {
    /// Read a `model.options` answer.
    #[must_use]
    pub fn from_options(answer: &Value) -> Self {
        let providers = answer
            .get("providers")
            .and_then(Value::as_array)
            .map(|rows| {
                rows.iter()
                    .filter_map(|r| {
                        let slug = r.get("slug").and_then(Value::as_str)?.trim().to_owned();
                        (!slug.is_empty()).then(|| Provider {
                            slug,
                            aliases: strings(r.get("aliases")),
                            signed_in: r.get("authenticated").and_then(Value::as_bool)
                                != Some(false),
                            models: strings(r.get("models")),
                            unavailable: strings(r.get("unavailable_models")),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { providers }
    }

    /// The providers the bot can use now, by slug.
    #[must_use]
    pub fn reachable(&self) -> Vec<&str> {
        self.providers
            .iter()
            .filter(|p| p.signed_in)
            .map(|p| p.slug.as_str())
            .collect()
    }

    fn row(&self, provider: &str) -> Option<&Provider> {
        let wanted = provider.trim();
        self.providers.iter().find(|p| {
            p.slug.eq_ignore_ascii_case(wanted)
                || p.aliases.iter().any(|a| a.eq_ignore_ascii_case(wanted))
        })
    }

    /// The sentence that says what `bot` can reach.
    fn can_reach(&self, bot: &str) -> String {
        let all = self.reachable();
        if all.is_empty() {
            format!(
                "{bot} reaches no provider yet: open boopis once so the bot is set up, or sign in to one in Settings > Models"
            )
        } else {
            let all: Vec<String> = all.into_iter().map(str::to_owned).collect();
            format!("{bot} can reach {}", bots::and_list(&all))
        }
    }

    /// Whether `bot` can run on `model` of `provider`, or why not, in a sentence.
    ///
    /// # Errors
    /// The sentence: an empty or unknown provider, one without a sign-in or key for this bot, or a model not in its
    /// catalogue (with some of the catalogue's models).
    pub fn check(&self, bot: &str, provider: &str, model: &str) -> Result<(), String> {
        let (provider, model) = (provider.trim(), model.trim());
        if model.is_empty() {
            return Err("name a model: --model <model> or --model <provider>/<model>".into());
        }
        if provider.is_empty() {
            return Err(format!(
                "{model:?} names no provider and the main profile has none to lend it: write it as <provider>/{model}. {}",
                self.can_reach(bot)
            ));
        }
        let Some(row) = self.row(provider) else {
            return Err(format!(
                "{provider} is not a provider {bot} can reach. {}",
                self.can_reach(bot)
            ));
        };
        if !row.signed_in {
            return Err(format!(
                "{bot} has no sign-in or key for {provider}: add it in Settings > Models. {}",
                self.can_reach(bot)
            ));
        }
        let named = |m: &String| m.eq_ignore_ascii_case(model) || model_names::same(m, model);
        if row.unavailable.iter().any(named) {
            return Err(format!(
                "{provider} lists {model} but this account cannot use it"
            ));
        }
        if row.models.is_empty() || row.models.iter().any(named) {
            return Ok(());
        }
        Err(format!(
            "{provider} has no model {model:?}. Its models: {}",
            some_of(&row.models, 8)
        ))
    }
}

/// Whether the engine pinned an alias that the provider floats itself: `asked` names one of its provider's own aliases
/// (`frontier::route_alias`, the Claude subscription's `haiku`) and the model read back is the id that alias names today,
/// spelled as the engine pins it (`claude-haiku-5-5[1m]`). The bot then keeps the alias as it was written. A provider that does
/// not float the alias (an API key's) gets no such rewrite: it would send the short name to an API that does not know it.
#[must_use]
pub fn keeps_alias(asked: &(String, String), now: &(String, String)) -> bool {
    now.0.eq_ignore_ascii_case(&asked.0)
        && !now.1.eq_ignore_ascii_case(&asked.1)
        && crate::frontier::route_alias(&asked.0, &asked.1)
            .is_some_and(|pinned| model_names::canon(&now.1) == model_names::canon(pinned))
}

/// A model as a person reads it: `provider/model`, or the model alone when it names no provider.
#[must_use]
pub fn label((provider, model): &(String, String)) -> String {
    if provider.is_empty() {
        model.clone()
    } else {
        format!("{provider}/{model}")
    }
}

/// What a `profiles.configure` answer says the engine did not save (its `applied` entries that are `false`), in words.
#[must_use]
pub fn not_saved(answer: &Value) -> Vec<String> {
    answer
        .get("applied")
        .and_then(Value::as_object)
        .map(|applied| {
            applied
                .iter()
                .filter(|(_, ok)| ok.as_bool() == Some(false))
                .map(|(part, _)| {
                    match part.as_str() {
                        "model" => "its model",
                        "description" => "its role",
                        "soul" => "its instructions",
                        "disabled_skills" => "its skills",
                        _ => "a setting",
                    }
                    .to_owned()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Whether the model read back after a write is the one asked for, given the one before. The engine may spell the model its
/// own way (a provider's form of the id); it may not leave the bot where it was, unless that is already the model asked for
/// (a new bot asked for the main profile's own model), or put it on another provider.
///
/// # Errors
/// The sentence for a model that did not change, or that changed to another provider's.
pub fn written(
    bot: &str,
    asked: &(String, String),
    before: &(String, String),
    now: &(String, String),
) -> Result<(), String> {
    let is_asked = now.0.eq_ignore_ascii_case(&asked.0)
        && (now.1.eq_ignore_ascii_case(&asked.1) || model_names::same(&now.1, &asked.1));
    if now == before && !is_asked {
        return Err(format!(
            "{bot}'s model was not changed: it is still {}, not {}",
            label(before),
            label(asked)
        ));
    }
    if !now.0.eq_ignore_ascii_case(&asked.0) {
        return Err(format!(
            "the engine set {bot}'s model to {}, not {}",
            label(now),
            label(asked)
        ));
    }
    Ok(())
}

/// What a bot can reach: the engine's `model.options` (the app's model picker's inventory) asked with the bot's name, which the
/// engine binds to the bot's home, its sign-ins and its plugins. `None` asks the root's own, which is what a bot made now gets.
///
/// # Errors
/// `hx.bots.model_unchecked` when the engine cannot be asked: nothing is changed then.
pub async fn reach(rpc: &dyn Rpc, bot: Option<&str>) -> error::Result<Reach> {
    let params = bot.map_or_else(|| json!({}), |b| json!({"profile": b}));
    match rpc.call("model.options", params).await {
        Ok(answer) => Ok(Reach::from_options(&answer)),
        Err(e) => Err(Error::Bots(
            "hx.bots.model_unchecked",
            format!(
                "which models it can reach could not be read, so nothing was changed: {}",
                error::unless_engine("hx.engine.refused", &e.to_string())
            ),
        )),
    }
}

/// Refuse a model the bot `name` cannot reach, before anything is written. `made` is false for a bot that does not exist yet:
/// it is checked against the root's providers, which `bots::prepare` gives a new bot.
///
/// # Errors
/// `hx.bots.model_unreachable` with the sentence of [`Reach::check`], or [`reach`]'s.
pub async fn check(
    rpc: &dyn Rpc,
    name: &str,
    asked: &(String, String),
    made: bool,
) -> error::Result<()> {
    reach(rpc, made.then_some(name))
        .await?
        .check(name, &asked.0, &asked.1)
        .map_err(|why| Error::Bots("hx.bots.model_unreachable", why))
}

/// The bot's model as its configuration says now (`profiles.describe`).
///
/// # Errors
/// The link's.
pub async fn model_now(rpc: &dyn Rpc, name: &str) -> error::Result<(String, String)> {
    Ok(bots::model_of(
        rpc.call("profiles.describe", json!({"name": name}))
            .await?
            .get("model"),
    ))
}

/// The code of a pick the engine wants the owner to confirm first (a costly model, a data policy): the app asks once and sends
/// it again with `confirm`.
pub const CONFIRM: &str = "hx.bots.confirm_model";

/// Make `asked` the bot's model with the engine's `profiles.configure`, which checks the pick against the provider once more
/// and writes nothing when it refuses, then read the configuration back: only a model that really changed is reported. An
/// alias the engine pinned ([`keeps_alias`]) is written back as asked, by the engine's own `config set` in the bot's `home`
/// (through `engine`, as `bots::prepare` writes every other key there). `confirm` is the owner's yes to a pick the engine
/// asked about ([`CONFIRM`]). Returns the model read back.
///
/// # Errors
/// [`CONFIRM`] with the engine's question; `hx.bots.not_saved` for a pick the engine refused (`applied.model` false) or a
/// configuration that read back otherwise ([`written`]); the link's.
pub async fn write(
    rpc: &dyn Rpc,
    engine: &dyn bots::Engine,
    home: &Path,
    name: &str,
    asked: &(String, String),
    confirm: bool,
) -> error::Result<(String, String)> {
    let before = model_now(rpc, name).await?;
    let mut params = json!({"name": name, "provider": asked.0, "model": asked.1});
    if confirm {
        params["confirm_expensive_model"] = json!(true);
    }
    let res = rpc.call("profiles.configure", params).await?;
    if res.get("confirm_required").and_then(Value::as_bool) == Some(true) {
        let asks = res
            .get("confirm_message")
            .and_then(Value::as_str)
            .filter(|m| !m.trim().is_empty())
            .map_or_else(
                || format!("Confirm {} before it is saved.", label(asked)),
                |m| error::unless_engine("hx.engine.refused", m),
            );
        return Err(Error::Bots(CONFIRM, asks));
    }
    if !not_saved(&res).is_empty() {
        return Err(Error::Bots(
            "hx.bots.not_saved",
            format!(
                "the engine refused {} for {name}, so its model was not changed",
                label(asked)
            ),
        ));
    }
    let mut now = model_now(rpc, name).await?;
    if keeps_alias(asked, &now) {
        engine.config_set(home, "model.default", &asked.1).await?;
        now = model_now(rpc, name).await?;
    }
    written(name, asked, &before, &now).map_err(|why| Error::Bots("hx.bots.not_saved", why))?;
    Ok(now)
}

/// The root's gateway as an [`Rpc`] for the app: one short link per call, through the engine's own `call`.
pub struct RootLink<'a> {
    /// The engine.
    pub engine: &'a dyn bots::Engine,
    /// The root's home.
    pub root: &'a Path,
}

#[async_trait]
impl Rpc for RootLink<'_> {
    async fn call(&self, method: &str, params: Value) -> error::Result<Value> {
        self.engine.call(self.root, method, params).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SUB: &str = "claude-subscription-directsdk-experimental";

    fn nimbus() -> Reach {
        Reach::from_options(&json!({"providers": [
            {"slug": SUB, "name": "Claude Subscription DirectSDK (Experimental)", "authenticated": true,
             "models": ["claude-opus-5-5[1m]", "claude-sonnet-5-5[1m]", "claude-haiku-5-5[1m]", "claude-fable-5-2[1m]"]},
            {"slug": "github-copilot", "authenticated": false, "models": ["gpt-6-luna"]},
            {"slug": "custom:my-box", "aliases": ["my-box"], "is_user_defined": true, "models": []},
            {"slug": "openrouter", "authenticated": true, "models": ["anthropic/claude-opus-5-5"], "unavailable_models": ["x/locked"]},
        ], "model": "opus", "provider": SUB}))
    }

    #[test]
    fn a_provider_the_bot_cannot_reach_is_refused_with_the_ones_it_can() {
        let r = nimbus();
        assert_eq!(r.reachable(), [SUB, "custom:my-box", "openrouter"]);
        let e = r.check("nimbus", "nosuchprovider", "xyz").unwrap_err();
        assert_eq!(
            e,
            format!(
                "nosuchprovider is not a provider nimbus can reach. nimbus can reach {SUB}, custom:my-box and openrouter"
            )
        );
        let e = r
            .check("nimbus", "github-copilot", "gpt-6-luna")
            .unwrap_err();
        assert!(
            e.starts_with("nimbus has no sign-in or key for github-copilot"),
            "{e}"
        );
        let e = r.check("nimbus", "", "opus").unwrap_err();
        assert!(e.contains("<provider>/opus"), "{e}");
        let none = Reach::from_options(&json!({"providers": []}));
        let e = none.check("kai", SUB, "opus").unwrap_err();
        assert!(e.contains("kai reaches no provider yet"), "{e}");
    }

    #[test]
    fn a_model_is_checked_against_the_catalogue_where_there_is_one() {
        let r = nimbus();
        // the ids, and the aliases the picker folds into them
        for m in [
            "claude-haiku-5-5[1m]",
            "haiku",
            "Opus",
            "sonnet",
            "claude-fable-5-2",
        ] {
            assert_eq!(r.check("nimbus", SUB, m), Ok(()), "{m}");
        }
        let e = r.check("nimbus", SUB, "xyz").unwrap_err();
        assert!(
            e.starts_with(&format!(
                "{SUB} has no model \"xyz\". Its models: claude-opus-5-5[1m]"
            )),
            "{e}"
        );
        // no catalogue: the engine judges the model
        assert_eq!(r.check("nimbus", "my-box", "anything-7b"), Ok(()));
        assert!(
            r.check("nimbus", "openrouter", "x/locked")
                .unwrap_err()
                .contains("cannot use it")
        );
        assert_eq!(
            r.check("nimbus", "openrouter", "anthropic/claude-opus-5-5"),
            Ok(())
        );
        assert!(r.check("nimbus", SUB, " ").is_err());
    }

    fn pair(p: &str, m: &str) -> (String, String) {
        (p.to_owned(), m.to_owned())
    }

    #[test]
    fn what_is_read_back_decides_what_is_reported() {
        let asked = pair(SUB, "sonnet");
        let before = pair(SUB, "opus");
        assert_eq!(
            written("nimbus", &asked, &before, &pair(SUB, "sonnet")),
            Ok(())
        );
        // the engine's own spelling of the id is still the model asked for
        assert_eq!(
            written(
                "nimbus",
                &asked,
                &before,
                &pair(SUB, "claude-sonnet-5-5[1m]")
            ),
            Ok(())
        );
        // a new bot asked for the main profile's own model: it is already there
        assert_eq!(written("nimbus", &before, &before, &before), Ok(()));
        let e = written("nimbus", &asked, &before, &before).unwrap_err();
        assert_eq!(
            e,
            format!("nimbus's model was not changed: it is still {SUB}/opus, not {SUB}/sonnet")
        );
        let e = written(
            "nimbus",
            &asked,
            &before,
            &pair("openrouter", "anthropic/claude-sonnet-5-5"),
        )
        .unwrap_err();
        assert!(
            e.starts_with("the engine set nimbus's model to openrouter/"),
            "{e}"
        );
    }

    #[test]
    fn an_alias_the_provider_floats_is_kept_and_no_other_name_is_rewritten() {
        // what `bots set nimbus --model haiku` read back on 0.1.9
        assert!(keeps_alias(
            &pair(SUB, "haiku"),
            &pair(SUB, "claude-haiku-5-5[1m]")
        ));
        assert!(keeps_alias(
            &pair(SUB, "sonnet"),
            &pair(SUB, "claude-sonnet-5-5[1m]")
        ));
        // already the alias, or an id asked for: nothing to keep
        assert!(!keeps_alias(&pair(SUB, "haiku"), &pair(SUB, "haiku")));
        assert!(!keeps_alias(
            &pair(SUB, "claude-haiku-5-5[1m]"),
            &pair(SUB, "claude-haiku-5-5[1m]")
        ));
        // pinned to another model, or moved to another provider
        assert!(!keeps_alias(
            &pair(SUB, "haiku"),
            &pair(SUB, "claude-sonnet-5-5[1m]")
        ));
        assert!(!keeps_alias(
            &pair(SUB, "haiku"),
            &pair("anthropic", "claude-haiku-5-5")
        ));
        // an API key's provider does not float `haiku`: its id stays as the engine wrote it
        assert!(!keeps_alias(
            &pair("anthropic", "haiku"),
            &pair("anthropic", "claude-haiku-5-5")
        ));
        // the engine's own spelling of an id is not an alias
        assert!(!keeps_alias(
            &pair(SUB, "claude-opus-5.5"),
            &pair(SUB, "claude-opus-5-5[1m]")
        ));
    }

    #[test]
    fn what_the_engine_did_not_save_is_named() {
        let a =
            json!({"ok": false, "applied": {"model": false, "description": true, "soul": false}});
        assert_eq!(not_saved(&a), ["its model", "its instructions"]);
        assert!(not_saved(&json!({"ok": true, "applied": {"model": true}})).is_empty());
        assert!(not_saved(&json!({"ok": true})).is_empty());
    }

    /// A scripted engine for one bot: its model, the providers it reaches, and what `profiles.configure` stores for a pick
    /// (`None`: it refuses, `applied.model` false, as the engine does when its own check fails).
    struct Scripted {
        model: std::sync::Mutex<(String, String)>,
        stores: fn(&str, &str) -> Option<(String, String)>,
        asked: std::sync::Mutex<Vec<(String, Value)>>,
    }

    impl Scripted {
        fn new(stores: fn(&str, &str) -> Option<(String, String)>) -> Self {
            Self {
                model: std::sync::Mutex::new(pair(SUB, "opus")),
                stores,
                asked: std::sync::Mutex::new(Vec::new()),
            }
        }
        fn methods(&self) -> Vec<String> {
            self.asked
                .lock()
                .unwrap()
                .iter()
                .map(|(m, _)| m.clone())
                .collect()
        }
    }

    #[async_trait::async_trait]
    impl Rpc for Scripted {
        async fn call(&self, method: &str, params: Value) -> error::Result<Value> {
            self.asked
                .lock()
                .unwrap()
                .push((method.to_owned(), params.clone()));
            match method {
                "model.options" => Ok(json!({"providers": [
                    {"slug": SUB, "authenticated": true, "models": ["claude-opus-5-5[1m]", "claude-haiku-5-5[1m]", "claude-fable-5-2[1m]"]},
                    {"slug": "openrouter", "authenticated": true, "models": []},
                ]})),
                "profiles.describe" => {
                    let (p, m) = self.model.lock().unwrap().clone();
                    Ok(json!({"name": params["name"], "model": {"provider": p, "default": m}}))
                }
                "profiles.configure" => {
                    let (p, m) = (
                        params["provider"].as_str().unwrap(),
                        params["model"].as_str().unwrap(),
                    );
                    // a costly pick is written only once the owner said yes, as the engine's guard does
                    if m == "claude-fable-5-2[1m]"
                        && params["confirm_expensive_model"] != json!(true)
                    {
                        return Ok(json!({"ok": true, "applied": {}, "confirm_required": true,
                            "confirm_message": "Fable bills usage credits from the first request."}));
                    }
                    Ok(match (self.stores)(p, m) {
                        Some(x) => {
                            *self.model.lock().unwrap() = x;
                            json!({"ok": true, "applied": {"model": true}})
                        }
                        None => json!({"ok": false, "applied": {"model": false}}),
                    })
                }
                other => panic!("not scripted: {other}"),
            }
        }
    }

    /// The engine's own `config set` in the bot's home, as `bots::prepare` uses it: only `model.default` is scripted.
    #[async_trait::async_trait]
    impl bots::Engine for Scripted {
        async fn config_get(&self, _: &Path, key: &str) -> error::Result<Option<Value>> {
            panic!("not scripted: config get {key}")
        }
        async fn config_set(&self, home: &Path, key: &str, value: &str) -> error::Result<()> {
            assert!(home.ends_with("profiles/nimbus"), "{}", home.display());
            assert_eq!(key, "model.default");
            self.asked
                .lock()
                .unwrap()
                .push(("config set".to_owned(), json!(value)));
            self.model.lock().unwrap().1 = value.to_owned();
            Ok(())
        }
        async fn config_unset(&self, _: &Path, key: &str) -> error::Result<()> {
            panic!("not scripted: config unset {key}")
        }
        async fn enable_plugin(&self, _: &Path, name: &str) -> error::Result<()> {
            panic!("not scripted: enable {name}")
        }
        /// The app's short links reach the same gateway.
        async fn call(&self, _: &Path, method: &str, params: Value) -> error::Result<Value> {
            Rpc::call(self, method, params).await
        }
        async fn reload_plugins(&self, _: &Path, _: &Path) -> error::Result<()> {
            panic!("not scripted: reload")
        }
        async fn restart_when_idle(&self, _: &Path) -> error::Result<bool> {
            panic!("not scripted: restart")
        }
    }

    async fn set(e: &Scripted, asked: (String, String)) -> error::Result<()> {
        write(
            e,
            e,
            Path::new("/e/profiles/nimbus"),
            "nimbus",
            &asked,
            false,
        )
        .await
        .map(|_| ())
    }

    /// B34: `boopis bots set nimbus --model haiku` wrote `claude-haiku-5-5[1m]`, and an exported team file then showed drift.
    #[tokio::test]
    async fn an_alias_the_engine_pins_is_written_back_as_asked() {
        let e = Scripted::new(|p, m| {
            Some(match (p, m) {
                (SUB, "haiku") => pair(SUB, "claude-haiku-5-5[1m]"),
                _ => pair(p, m),
            })
        });
        set(&e, pair(SUB, "haiku")).await.unwrap();
        assert_eq!(*e.model.lock().unwrap(), pair(SUB, "haiku"));
        assert_eq!(
            e.methods(),
            [
                "profiles.describe",
                "profiles.configure",
                "profiles.describe",
                "config set",
                "profiles.describe"
            ]
        );
        // an id asked for stays the id; nothing is written back
        let e = Scripted::new(|p, m| Some(pair(p, m)));
        set(&e, pair(SUB, "claude-haiku-5-5[1m]")).await.unwrap();
        assert!(!e.methods().contains(&"config set".to_owned()));
    }

    /// B33: `boopis bots set nimbus --model nosuchprovider/xyz` said "changed" and left the configuration as it was.
    #[tokio::test]
    async fn an_unreachable_model_is_refused_before_anything_is_written() {
        let e = Scripted::new(|p, m| Some(pair(p, m)));
        let err = check(&e, "nimbus", &pair("nosuchprovider", "xyz"), true)
            .await
            .unwrap_err();
        assert_eq!(err.code(), "hx.bots.model_unreachable");
        assert_eq!(
            err.to_string(),
            format!(
                "nosuchprovider is not a provider nimbus can reach. nimbus can reach {SUB} and openrouter"
            )
        );
        // asked in nimbus's own scope, and nothing written
        assert_eq!(e.asked.lock().unwrap()[0].1, json!({"profile": "nimbus"}));
        assert_eq!(e.methods(), ["model.options"]);
        // a bot not made yet is checked against the root's providers
        check(&e, "iris2", &pair(SUB, "haiku"), false)
            .await
            .unwrap();
        assert_eq!(e.asked.lock().unwrap()[1].1, json!({}));
    }

    #[tokio::test]
    async fn changed_is_said_only_when_the_configuration_changed() {
        // the engine takes the pick: read back, it is the model asked for
        let e = Scripted::new(|p, m| Some(pair(p, m)));
        set(&e, pair("openrouter", "some/model")).await.unwrap();
        assert_eq!(*e.model.lock().unwrap(), pair("openrouter", "some/model"));
        assert_eq!(
            e.methods(),
            [
                "profiles.describe",
                "profiles.configure",
                "profiles.describe"
            ]
        );
        // the engine refuses it: the error says so, and the model is as it was
        let e = Scripted::new(|_, _| None);
        let err = set(&e, pair("openrouter", "nope")).await.unwrap_err();
        assert_eq!(
            err.to_string(),
            "the engine refused openrouter/nope for nimbus, so its model was not changed"
        );
        assert_eq!(*e.model.lock().unwrap(), pair(SUB, "opus"));
        // the engine says it applied the pick but the configuration did not move: read back, it is not reported as changed
        let e = Scripted::new(|_, _| Some(pair(SUB, "opus")));
        let err = set(&e, pair("openrouter", "x")).await.unwrap_err();
        assert!(
            err.to_string()
                .starts_with("nimbus's model was not changed"),
            "{err}"
        );
    }

    /// The app's way in: `Service::set_model` with no link of its own (short links through the engine, `RootLink`), as
    /// `bots_set_model` calls it. The same check, write and read-back as the command line's.
    mod the_apps_path {
        use super::*;
        use std::sync::Arc;

        fn service(
            e: &Arc<Scripted>,
        ) -> (tempfile::TempDir, bots::Layout, Arc<bots::engine::Service>) {
            let dir = tempfile::tempdir().unwrap();
            std::fs::create_dir_all(dir.path().join("profiles").join("nimbus")).unwrap();
            let layout = bots::Layout::new(dir.path().to_path_buf(), &[]);
            let svc = Arc::new(bots::engine::Service::with_engine(e.clone()));
            (dir, layout, svc)
        }

        #[tokio::test]
        async fn a_refused_pick_leaves_the_model_and_says_what_the_bot_can_reach() {
            let e = Arc::new(Scripted::new(|p, m| Some(pair(p, m))));
            let (_dir, layout, svc) = service(&e);
            let err = svc
                .set_model(
                    None,
                    &layout,
                    "nimbus",
                    &pair("nosuchprovider", "xyz"),
                    false,
                )
                .await
                .unwrap_err();
            assert_eq!(err.code(), "hx.bots.model_unreachable");
            let shown = crate::error::HostError::from(err).message;
            assert_eq!(
                shown,
                format!(
                    "nosuchprovider is not a provider nimbus can reach. nimbus can reach {SUB} and openrouter"
                )
            );
            assert_eq!(*e.model.lock().unwrap(), pair(SUB, "opus"));
            assert!(!e.methods().contains(&"profiles.configure".to_owned()));
        }

        #[tokio::test]
        async fn a_pick_ends_on_that_model_and_an_alias_stays_one() {
            let e = Arc::new(Scripted::new(|p, m| {
                Some(match (p, m) {
                    (SUB, "haiku") => pair(SUB, "claude-haiku-5-5[1m]"),
                    _ => pair(p, m),
                })
            }));
            let (_dir, layout, svc) = service(&e);
            let now = svc
                .set_model(None, &layout, "nimbus", &pair(SUB, "haiku"), false)
                .await
                .unwrap();
            assert_eq!(now, pair(SUB, "haiku"));
            assert_eq!(*e.model.lock().unwrap(), pair(SUB, "haiku"));
        }

        #[tokio::test]
        async fn an_engine_that_claims_success_without_writing_is_caught() {
            let e = Arc::new(Scripted::new(|_, _| Some(pair(SUB, "opus"))));
            let (_dir, layout, svc) = service(&e);
            let err = svc
                .set_model(
                    None,
                    &layout,
                    "nimbus",
                    &pair("openrouter", "some/model"),
                    false,
                )
                .await
                .unwrap_err();
            assert_eq!(err.code(), "hx.bots.not_saved");
            assert!(
                err.to_string()
                    .starts_with("nimbus's model was not changed"),
                "{err}"
            );
        }

        #[tokio::test]
        async fn a_costly_pick_is_asked_about_then_written_once_confirmed() {
            let e = Arc::new(Scripted::new(|p, m| Some(pair(p, m))));
            let (_dir, layout, svc) = service(&e);
            let fable = pair(SUB, "claude-fable-5-2[1m]");
            let err = svc
                .set_model(None, &layout, "nimbus", &fable, false)
                .await
                .unwrap_err();
            assert_eq!(err.code(), CONFIRM);
            assert_eq!(
                err.to_string(),
                "Fable bills usage credits from the first request."
            );
            assert_eq!(*e.model.lock().unwrap(), pair(SUB, "opus"));
            assert_eq!(
                svc.set_model(None, &layout, "nimbus", &fable, true)
                    .await
                    .unwrap(),
                fable
            );
        }

        #[tokio::test]
        async fn a_bot_that_is_not_there_is_not_asked_about() {
            let e = Arc::new(Scripted::new(|p, m| Some(pair(p, m))));
            let (_dir, layout, svc) = service(&e);
            let err = svc
                .set_model(None, &layout, "ghost", &pair(SUB, "opus"), false)
                .await
                .unwrap_err();
            assert_eq!(err.code(), "hx.bots.not_found");
            assert!(e.methods().is_empty());
        }
    }

    #[test]
    fn a_long_catalogue_is_cut_short() {
        let models: Vec<String> = (0..12).map(|i| format!("m{i}")).collect();
        assert_eq!(
            some_of(&models, 8),
            "m0, m1, m2, m3, m4, m5, m6, m7 and 4 more"
        );
        assert_eq!(some_of(&models[..2], 8), "m0 and m1");
    }
}
