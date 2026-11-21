//! The two xAI choices of setup that are not a key (ADR-0039): the SuperGrok subscription, signed in through boopis's own sign-in
//! (`crate::xai`), and the user's own `grok` program, driven by the community `grok-acp` plugin. The key choice is
//! `providers::xai`. Each writes its own route and only its own: a ladder of the engine's `xai-oauth` or `grok-acp` provider, so
//! switching from one to another rewrites `model.provider`, `model.default` and the ladder together and leaves no tier naming the
//! way that was left. Grok is a heavy model (ADR-0037), so, as with the key, a governed ladder is written only once the user turned
//! Grok on.

use serde_json::json;

use super::ops::HermesOps;
use super::providers::Outcome;
use super::providers::{GROK_FAMILY, Input, lowest_in_family, write_route};
use crate::commands::Json;
use crate::error::{Error, Result};
use crate::setup::Form;
use crate::xai::cli::{self, State};

/// The choice that runs on the user's SuperGrok subscription, signed in through boopis's own sign-in.
pub const XAI_SUBSCRIPTION: &str = "xai-subscription";
const XAI_SUBSCRIPTION_LABEL: &str = "xAI SuperGrok subscription (sign in with your X or xAI account; governed mode only after you turn on Grok, a heavy model)";
/// The choice that runs on the user's own `grok` program.
pub const GROK_CLI: &str = "grok-cli";
const GROK_CLI_LABEL: &str =
    "Your own Grok program (runs on the grok program installed and signed in on this computer)";
/// The engine's provider of the sign-in: its pool row is the one `plugins/boopis/signins/xai.py` keeps.
pub const SIGNIN_PROVIDER: &str = "xai-oauth";

/// Add the xAI choices that are not a key to the model question: the subscription always, the program only while the sign-in is
/// not in use (`offered_when: signin_unused`).
pub fn add_choices(ids: &mut Vec<String>, labels: &mut Vec<String>, signed_in: bool) {
    ids.push(XAI_SUBSCRIPTION.to_owned());
    labels.push(XAI_SUBSCRIPTION_LABEL.to_owned());
    if cli::offered(signed_in) {
        ids.push(GROK_CLI.to_owned());
        labels.push(GROK_CLI_LABEL.to_owned());
    }
}

fn sign_in_form() -> Form {
    let mut form = Form::new(
        "setup.xai",
        "setup",
        "Sign in with SuperGrok",
        "Choose Sign in with SuperGrok: boopis shows a one-time code, you open xAI's sign-in page, sign in with your X or xAI account and approve it. boopis keeps the sign-in in your OS keychain and renews it by itself. xAI may refuse the sign-in on some plans whatever your subscription says; an xAI API key works then. Grok 4.7 and later is a heavy model, so governed mode uses it only once you turn on Grok in Settings, Models.",
        json!({"type": "object", "properties": {}}),
    );
    form.signin = Some(super::SignIn {
        provider: super::SIGNIN_XAI.into(),
        label: "Sign in with SuperGrok".into(),
    });
    form.submit = Json(json!({"label": "Check again"}));
    form.cancel = Json(json!({"label": "Choose another model"}));
    form
}

/// The SuperGrok subscription: sign in (a form with the card), then, only when Grok is turned on, a ladder of the lowest Grok 4.7
/// or later the account's own catalogue lists, on `xai-oauth`.
pub async fn subscription(
    ops: &dyn HermesOps,
    input: &Input<'_>,
    restart: &mut bool,
) -> Result<Outcome> {
    if !input.xai_signed_in {
        return Ok(Outcome::Form(sign_in_form()));
    }
    if !input.optins.has("grok") {
        return Ok(Outcome::Done(
            "xAI SuperGrok: signed in. Grok 4.7 and later is a heavy model (token-heavy), so governed mode stays unavailable on it until you turn on Grok in Settings, Models. Sessions that are not governed can use it now".into(),
        ));
    }
    let catalogue = ops.provider_models(SIGNIN_PROVIDER).await?;
    let Some(id) = lowest_in_family(SIGNIN_PROVIDER, GROK_FAMILY, &catalogue, true) else {
        return Ok(Outcome::Done(
            "xAI SuperGrok: signed in, but your account's catalogue lists no Grok 4.7 or later, so governed mode is unavailable on it".into(),
        ));
    };
    *restart |= write_route(
        ops,
        &[("grok".to_owned(), format!("{SIGNIN_PROVIDER}/{id}"))],
    )
    .await?;
    Ok(Outcome::Done(format!(
        "xAI SuperGrok: {id} on your SuperGrok sign-in (heavy: it is on the ladder because you turned it on)"
    )))
}

fn program_form(probe: &cli::Probe) -> Form {
    let title = match probe.state {
        State::NotInstalled => "Install the grok program to use your Grok subscription",
        State::SignedOut => "Sign in to the grok program",
        State::OldVersion => "Update the grok program",
        State::SignedIn => "The grok program is ready",
    };
    let mut steps: Vec<(String, String)> = Vec::new();
    let tail = match probe.state {
        State::NotInstalled => {
            steps.push(("Install it".into(), format!("`{}`", cli::install_command())));
            "Run it in a terminal, then sign in with `grok login` and choose Check again."
        }
        State::OldVersion => {
            steps.push(("Update it".into(), format!("`{}`", cli::install_command())));
            "Run it in a terminal, then choose Check again."
        }
        State::SignedOut => {
            steps.push(("Sign in".into(), format!("`{}`", cli::LOGIN_COMMAND)));
            "Run it in a terminal, then choose Check again."
        }
        State::SignedIn => "",
    };
    let mut form = Form::new(
        "setup.grok",
        "setup",
        title,
        &format!(
            "{}\n\n{tail} grok is xAI's own program: it does the signing in and keeps your login. boopis never sees, reads or stores it; it only asks the program whether it is signed in. This is the second way to use your subscription, shown while the SuperGrok sign-in is not in use.",
            probe.detail
        ),
        json!({"type": "object", "properties": {}}),
    );
    form.contents = steps;
    form.submit = Json(json!({"label": "Check again"}));
    form.cancel = Json(json!({"label": "Choose another model"}));
    form
}

/// The user's own `grok` program: look at it, check that the engine carries the plugin (it comes inside boopis's runtime), enable
/// it, and, only when Grok is turned on, write a ladder of the lowest Grok 4.7 or later the program lists, on `grok-acp`.
pub async fn program(
    ops: &dyn HermesOps,
    input: &Input<'_>,
    restart: &mut bool,
) -> Result<Outcome> {
    let probe = input.grok.probe().await;
    if !probe.usable() {
        return Ok(Outcome::Form(program_form(&probe)));
    }
    match ops
        .plugins()
        .await?
        .iter()
        .find(|p| p.name == cli::PROVIDER_ID)
    {
        None => {
            return Err(Error::Setup(
                "hx.setup.subscription_unavailable",
                "This engine does not include the Grok program route. It comes with boopis's own engine; choose another model, or start boopis with its own engine.".into(),
            ));
        }
        Some(p) if !p.enabled => {
            ops.enable_plugin(cli::PROVIDER_ID).await?;
            *restart = true;
        }
        Some(_) => {}
    }
    if !input.optins.has("grok") {
        return Ok(Outcome::Done(
            "Your grok program is ready. Grok 4.7 and later is a heavy model (token-heavy), so governed mode stays unavailable on it until you turn on Grok in Settings, Models. Sessions that are not governed can use it now".into(),
        ));
    }
    let catalogue = ops.provider_models(cli::PROVIDER_ID).await?;
    let Some(id) = lowest_in_family(cli::PROVIDER_ID, GROK_FAMILY, &catalogue, true) else {
        return Ok(Outcome::Done(
            "Your grok program is ready, but it lists no Grok 4.7 or later, so governed mode is unavailable on it".into(),
        ));
    };
    *restart |= write_route(
        ops,
        &[("grok".to_owned(), format!("{}/{id}", cli::PROVIDER_ID))],
    )
    .await?;
    Ok(Outcome::Done(format!(
        "Your grok program: {id} (heavy: it is on the ladder because you turned it on)"
    )))
}
