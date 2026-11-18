//! `hx`: the binary the hypotaxis plugin drives over JSON-RPC on stdio.
//!
//! ```text
//! hx serve                      JSON-RPC 2.0 over stdio, until stdin closes
//! hx describe                   print the hx.describe result
//! hx schema                     print the hx-v1 JSON Schema
//! hx txn validate|apply|restore|discard|recover --json <file|->
//! hx pack search|read|symbol|outline|status|bundle --json <file|->
//! hx sandbox run --json <file|->     |     hx sandbox capabilities
//! ```
//!
//! Stdout carries protocol frames (serve) or one JSON-RPC response (one-shot) and nothing else.
//! Logs go to `--log-file` or to stderr.

use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand};
use hx::serve::{ServeOptions, serve};
use hx::{build_dispatcher, oneshot};
use hx_pack::LogRedactor;
use hx_proto::log::{LogConfig, LogSink};
use hx_proto::method;
use tokio_util::sync::CancellationToken;

#[derive(Parser)]
#[command(
    name = "hx",
    version,
    about = "File transactions and more for the hypotaxis plugin"
)]
struct Cli {
    /// Write JSON logs to this file (rotated at 10 MiB, 5 kept) instead of stderr.
    #[arg(long, global = true)]
    log_file: Option<PathBuf>,
    /// A tracing filter, such as `info` or `hx_txn=debug`.
    #[arg(long, global = true)]
    log_level: Option<String>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Serve JSON-RPC 2.0 over stdio until stdin closes.
    Serve {
        /// Most requests that run at once.
        #[arg(long)]
        max_concurrency: Option<usize>,
    },
    /// Print the `hx.describe` result.
    Describe,
    /// Print the `hx-v1` JSON Schema.
    Schema,
    /// File transactions.
    Txn {
        #[command(subcommand)]
        action: TxnAction,
    },
    /// Search, read, symbols, outlines and git status.
    Pack {
        #[command(subcommand)]
        action: PackAction,
    },
    /// Run a command in the OS sandbox, or report what the sandbox can enforce here.
    Sandbox {
        #[command(subcommand)]
        action: SandboxAction,
    },
}

#[derive(Subcommand)]
enum PackAction {
    /// Matches with surrounding lines (`pack.search`).
    Search(Input),
    /// A file or line ranges (`pack.read`).
    Read(Input),
    /// The source of named definitions (`pack.symbol`).
    Symbol(Input),
    /// The definitions of files and directories (`pack.outline`).
    Outline(Input),
    /// Git status, branch and HEAD (`pack.status`).
    Status(Input),
    /// Several of the above under one byte budget (`pack.bundle`).
    Bundle(Input),
}

#[derive(Subcommand)]
enum SandboxAction {
    /// Run one command to completion (`sandbox.run`).
    Run(Input),
    /// What this host can enforce (`sandbox.capabilities`).
    Capabilities,
}

#[derive(Subcommand)]
enum TxnAction {
    /// Check every edit in memory; write nothing (`txn.validate`).
    Validate(Input),
    /// Validate, journal and apply (`txn.apply`).
    Apply(Input),
    /// Undo a transaction from its journal (`txn.restore`).
    Restore(Input),
    /// Keep the changes and drop the journal (`txn.discard`).
    Discard(Input),
    /// Restore every interrupted transaction (`txn.recover`).
    Recover(Input),
}

#[derive(Args)]
struct Input {
    /// The request params as JSON: a file path, or `-` for stdin.
    #[arg(long, value_name = "FILE|-")]
    json: String,
}

fn init_logging(cli: &Cli, default_filter: &str) -> Result<()> {
    // Fail closed: without working redaction rules hx does not log at all.
    let redactor = LogRedactor::embedded().context("the redaction rules do not load")?;
    let mut config = LogConfig::new(Arc::new(redactor));
    config.filter = cli
        .log_level
        .clone()
        .unwrap_or_else(|| default_filter.to_owned());
    if let Some(path) = &cli.log_file {
        config.sink = LogSink::File(path.clone());
    }
    hx_proto::log::init(&config).context("could not set up logging")
}

async fn run_serve(max_concurrency: Option<usize>) -> Result<()> {
    let shutdown = CancellationToken::new();
    let on_signal = shutdown.clone();
    tokio::spawn(async move {
        wait_for_signal().await;
        tracing::info!("signal received; shutting down");
        on_signal.cancel();
    });
    let mut opts = ServeOptions::default();
    if let Some(n) = max_concurrency {
        opts.max_concurrency = n;
    }
    tracing::info!(
        version = hx::VERSION,
        max_concurrency = opts.max_concurrency,
        "hx serving on stdio"
    );
    serve(
        tokio::io::stdin(),
        tokio::io::stdout(),
        Arc::new(build_dispatcher()),
        opts,
        shutdown,
    )
    .await
    .context("serving stdio")?;
    tracing::info!("stdin closed; hx stopped");
    Ok(())
}

#[cfg(unix)]
async fn wait_for_signal() {
    use tokio::signal::unix::{SignalKind, signal};
    let term = signal(SignalKind::terminate());
    let int = signal(SignalKind::interrupt());
    match (term, int) {
        (Ok(mut term), Ok(mut int)) => {
            tokio::select! { _ = term.recv() => {}, _ = int.recv() => {} }
        }
        _ => std::future::pending::<()>().await,
    }
}

#[cfg(not(unix))]
async fn wait_for_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

async fn run_oneshot(method: &str, params_source: Option<&str>) -> Result<ExitCode> {
    let params = params_source
        .map(oneshot::read_source)
        .transpose()
        .context("could not read the --json input")?;
    let dispatcher = build_dispatcher();
    let response = oneshot::run(
        &dispatcher,
        method,
        params.as_deref(),
        CancellationToken::new(),
    )
    .await;
    println!(
        "{}",
        response
            .to_frame()
            .context("could not serialise the response")?
    );
    Ok(ExitCode::from(
        u8::try_from(oneshot::exit_code(&response)).unwrap_or(1),
    ))
}

async fn run(cli: Cli) -> Result<ExitCode> {
    match &cli.command {
        Command::Serve { max_concurrency } => {
            init_logging(&cli, "info")?;
            run_serve(*max_concurrency)
                .await
                .map(|()| ExitCode::SUCCESS)
        }
        Command::Describe => {
            init_logging(&cli, "warn")?;
            run_oneshot(method::DESCRIBE, None).await
        }
        Command::Schema => {
            print!("{}", hx::schema::schema_text()?);
            Ok(ExitCode::SUCCESS)
        }
        Command::Txn { action } => {
            init_logging(&cli, "warn")?;
            let (name, input) = match action {
                TxnAction::Validate(i) => (method::TXN_VALIDATE, i),
                TxnAction::Apply(i) => (method::TXN_APPLY, i),
                TxnAction::Restore(i) => (method::TXN_RESTORE, i),
                TxnAction::Discard(i) => (method::TXN_DISCARD, i),
                TxnAction::Recover(i) => (method::TXN_RECOVER, i),
            };
            run_oneshot(name, Some(&input.json)).await
        }
        Command::Pack { action } => {
            init_logging(&cli, "warn")?;
            let (name, input) = match action {
                PackAction::Search(i) => (method::PACK_SEARCH, i),
                PackAction::Read(i) => (method::PACK_READ, i),
                PackAction::Symbol(i) => (method::PACK_SYMBOL, i),
                PackAction::Outline(i) => (method::PACK_OUTLINE, i),
                PackAction::Status(i) => (method::PACK_STATUS, i),
                PackAction::Bundle(i) => (method::PACK_BUNDLE, i),
            };
            run_oneshot(name, Some(&input.json)).await
        }
        Command::Sandbox { action } => {
            init_logging(&cli, "warn")?;
            match action {
                SandboxAction::Run(input) => {
                    run_oneshot(hx_sandbox::wire::METHOD_RUN, Some(&input.json)).await
                }
                SandboxAction::Capabilities => {
                    run_oneshot(hx_sandbox::wire::METHOD_CAPABILITIES, None).await
                }
            }
        }
    }
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("hx: cannot start the async runtime: {e}");
            return ExitCode::from(70);
        }
    };
    let code = match runtime.block_on(run(cli)) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("hx: {e:#}");
            ExitCode::from(70)
        }
    };
    // Stdin reads run on a blocking thread that cannot be interrupted; do not wait for it.
    runtime.shutdown_timeout(Duration::from_millis(200));
    code
}
