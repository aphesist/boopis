use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use anyhow::Result;
use hypotaxis_contracts::{ExecRequest, ExecResult, ExecToolCall, PackRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinSet;

use crate::pack::pack;

const PYTHON_REPL_WORKER: &str = r#"import ast, io, json, sys, traceback

_proto_in = sys.stdin
_proto_out = sys.stdout
_ns = {"__name__": "__hypotaxis_repl__"}

def _run_code(code, tool_results):
    if tool_results is not None:
        _ns["tool_results"] = tool_results
    out_buf = io.StringIO()
    err_buf = io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = out_buf, err_buf
    exit_code = 0
    try:
        tree = ast.parse(code, mode="exec")
        if tree.body and isinstance(tree.body[-1], ast.Expr):
            head = ast.Module(body=tree.body[:-1], type_ignores=[])
            if head.body:
                exec(compile(head, "<exec>", "exec"), _ns)
            last_expr = ast.Expression(body=tree.body[-1].value)
            val = eval(compile(last_expr, "<exec>", "eval"), _ns)
            if val is not None:
                print(repr(val))
        else:
            exec(compile(tree, "<exec>", "exec"), _ns)
    except SystemExit as e:
        code_val = e.code
        exit_code = code_val if isinstance(code_val, int) else (0 if code_val is None else 1)
    except Exception:
        traceback.print_exc(file=err_buf)
        exit_code = 1
    finally:
        sys.stdout, sys.stderr = old_out, old_err
    persisted = sorted(
        k for k in _ns.keys()
        if not k.startswith("_") and k != "tool_results"
    )
    return {
        "stdout": out_buf.getvalue(),
        "stderr": err_buf.getvalue(),
        "exit_code": exit_code,
        "persisted_vars": persisted,
    }

for _line in _proto_in:
    _line = _line.strip()
    if not _line:
        continue
    try:
        _req = json.loads(_line)
        _res = _run_code(_req.get("code", ""), _req.get("tool_results"))
    except Exception as _exc:
        _res = {
            "stdout": "",
            "stderr": f"repl protocol error: {_exc}",
            "exit_code": 1,
            "persisted_vars": [],
        }
    _proto_out.write(json.dumps(_res) + "\n")
    _proto_out.flush()
"#;

pub type ToolHandler = Arc<
    dyn Fn(ExecToolCall) -> Pin<Box<dyn Future<Output = Value> + Send>> + Send + Sync,
>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParallelToolOutput {
    pub index: usize,
    pub tool: String,
    pub ok: bool,
    pub output: Value,
}

#[derive(Debug, Serialize)]
struct ReplWireRequest<'a> {
    code: &'a str,
    tool_results: Option<&'a [ParallelToolOutput]>,
}

#[derive(Debug, Deserialize)]
struct ReplWireResponse {
    stdout: String,
    stderr: String,
    exit_code: i32,
    persisted_vars: Vec<String>,
}

struct ReplSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

/// Manages persistent stateful Python REPL sessions per `session_id` and async parallel tool hooks.
pub struct ExecManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Mutex<ReplSession>>>>>,
    handlers: Arc<RwLock<HashMap<String, ToolHandler>>>,
    python_override: Option<String>,
}

impl Default for ExecManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ExecManager {
    pub fn new() -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            handlers: Arc::new(RwLock::new(HashMap::new())),
            python_override: None,
        };
        manager.install_default_handlers();
        manager
    }

    /// Construct an `ExecManager` pinned to a specific Python binary path/name (useful for fallback tests).
    pub fn with_python_bin(python_bin: impl Into<String>) -> Self {
        let manager = Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            handlers: Arc::new(RwLock::new(HashMap::new())),
            python_override: Some(python_bin.into()),
        };
        manager.install_default_handlers();
        manager
    }

    fn install_default_handlers(&self) {
        if let Ok(mut map) = self.handlers.try_write() {
            map.insert(
                "echo".to_string(),
                Arc::new(|call| Box::pin(async move { call.args })),
            );
            map.insert(
                "pack".to_string(),
                Arc::new(|call| {
                    Box::pin(async move {
                        match serde_json::from_value::<PackRequest>(call.args) {
                            Ok(req) => match tokio::task::spawn_blocking(move || pack(req)).await {
                                Ok(Ok(res)) => serde_json::to_value(res).unwrap_or(Value::Null),
                                Ok(Err(err)) => json!({ "error": err.to_string() }),
                                Err(err) => json!({ "error": err.to_string() }),
                            },
                            Err(err) => json!({ "error": format!("invalid pack args: {err}") }),
                        }
                    })
                }),
            );
        }
    }

    /// Register or replace a parallel tool dispatch hook invoked when `ExecRequest.parallel_tools` runs.
    pub async fn register_tool(&self, name: impl Into<String>, handler: ToolHandler) {
        let mut map = self.handlers.write().await;
        map.insert(name.into(), handler);
    }

    /// Close and terminate a persistent session if active.
    pub async fn close_session(&self, session_id: &str) {
        let existing = {
            let mut map = self.sessions.lock().await;
            map.remove(session_id)
        };
        if let Some(session_arc) = existing {
            let mut guard = session_arc.lock().await;
            let _ = guard.child.kill().await;
        }
    }

    /// Execute `parallel_tools` concurrently and evaluate `req.code` inside the persistent Python REPL
    /// mapped to `req.session_id`.
    pub async fn exec(&self, req: ExecRequest) -> Result<ExecResult> {
        let started = Instant::now();
        let tool_outputs = self.dispatch_parallel_tools(&req.parallel_tools).await;

        let session_id = if req.session_id.trim().is_empty() {
            "default".to_string()
        } else {
            req.session_id.clone()
        };

        let session_arc = match self.get_or_spawn_session(&session_id).await {
            Ok(arc) => arc,
            Err(err_msg) => {
                let mut stdout = String::new();
                if !tool_outputs.is_empty() {
                    if let Ok(json_tools) = serde_json::to_string(&tool_outputs) {
                        stdout = json_tools;
                    }
                }
                return Ok(ExecResult {
                    stdout,
                    stderr: err_msg,
                    exit_code: 127,
                    persisted_vars: Vec::new(),
                    duration_ms: started.elapsed().as_millis() as u64,
                });
            }
        };

        let wire_req = ReplWireRequest {
            code: &req.code,
            tool_results: if tool_outputs.is_empty() {
                None
            } else {
                Some(&tool_outputs)
            },
        };
        let payload_line = format!("{}\n", serde_json::to_string(&wire_req)?);

        let timeout = if req.timeout_ms > 0 {
            Some(Duration::from_millis(req.timeout_ms))
        } else {
            None
        };

        let mut guard = session_arc.lock().await;
        let io_future = async {
            guard.stdin.write_all(payload_line.as_bytes()).await?;
            guard.stdin.flush().await?;
            let mut response_line = String::new();
            let bytes = guard.stdout.read_line(&mut response_line).await?;
            Ok::<(usize, String), std::io::Error>((bytes, response_line))
        };

        let outcome = if let Some(dur) = timeout {
            match tokio::time::timeout(dur, io_future).await {
                Ok(res) => res,
                Err(_) => {
                    let _ = guard.child.kill().await;
                    drop(guard);
                    self.sessions.lock().await.remove(&session_id);
                    return Ok(ExecResult {
                        stdout: String::new(),
                        stderr: format!("execution timed out after {} ms", req.timeout_ms),
                        exit_code: 124,
                        persisted_vars: Vec::new(),
                        duration_ms: started.elapsed().as_millis() as u64,
                    });
                }
            }
        } else {
            io_future.await
        };

        match outcome {
            Ok((0, _)) => {
                // Child exited cleanly or unexpectedly (e.g., os._exit or missing runtime stub).
                let status_code = guard
                    .child
                    .try_wait()
                    .ok()
                    .flatten()
                    .and_then(|s| s.code())
                    .unwrap_or(127);
                let _ = guard.child.kill().await;
                drop(guard);
                self.sessions.lock().await.remove(&session_id);
                Ok(ExecResult {
                    stdout: String::new(),
                    stderr: "python REPL session exited unexpectedly (EOF on stdout)".to_string(),
                    exit_code: if status_code == 0 { 127 } else { status_code },
                    persisted_vars: Vec::new(),
                    duration_ms: started.elapsed().as_millis() as u64,
                })
            }
            Ok((_, line)) => match serde_json::from_str::<ReplWireResponse>(&line) {
                Ok(parsed) => Ok(ExecResult {
                    stdout: parsed.stdout,
                    stderr: parsed.stderr,
                    exit_code: parsed.exit_code,
                    persisted_vars: parsed.persisted_vars,
                    duration_ms: started.elapsed().as_millis() as u64,
                }),
                Err(err) => {
                    let _ = guard.child.kill().await;
                    drop(guard);
                    self.sessions.lock().await.remove(&session_id);
                    Ok(ExecResult {
                        stdout: String::new(),
                        stderr: format!("invalid REPL response JSON: {err}; raw: {line}"),
                        exit_code: 127,
                        persisted_vars: Vec::new(),
                        duration_ms: started.elapsed().as_millis() as u64,
                    })
                }
            },
            Err(err) => {
                let _ = guard.child.kill().await;
                drop(guard);
                self.sessions.lock().await.remove(&session_id);
                Ok(ExecResult {
                    stdout: String::new(),
                    stderr: format!("python REPL I/O error: {err}"),
                    exit_code: 127,
                    persisted_vars: Vec::new(),
                    duration_ms: started.elapsed().as_millis() as u64,
                })
            }
        }
    }

    async fn dispatch_parallel_tools(&self, calls: &[ExecToolCall]) -> Vec<ParallelToolOutput> {
        if calls.is_empty() {
            return Vec::new();
        }

        let handlers_snapshot = { self.handlers.read().await.clone() };
        let mut join_set = JoinSet::new();

        for (index, call) in calls.iter().cloned().enumerate() {
            let handler = handlers_snapshot.get(&call.tool).cloned();
            join_set.spawn(async move {
                match handler {
                    Some(func) => {
                        let output = func(call.clone()).await;
                        ParallelToolOutput {
                            index,
                            tool: call.tool,
                            ok: true,
                            output,
                        }
                    }
                    None => ParallelToolOutput {
                        index,
                        tool: call.tool.clone(),
                        ok: false,
                        output: json!({
                            "error": format!("unregistered parallel tool '{}'", call.tool),
                            "args": call.args,
                        }),
                    },
                }
            });
        }

        let mut results = Vec::with_capacity(calls.len());
        while let Some(res) = join_set.join_next().await {
            if let Ok(item) = res {
                results.push(item);
            }
        }
        results.sort_by_key(|r| r.index);
        results
    }

    async fn get_or_spawn_session(
        &self,
        session_id: &str,
    ) -> std::result::Result<Arc<Mutex<ReplSession>>, String> {
        {
            let mut map = self.sessions.lock().await;
            if let Some(existing) = map.get(session_id).cloned() {
                let mut guard = existing.lock().await;
                if matches!(guard.child.try_wait(), Ok(None)) {
                    drop(guard);
                    return Ok(existing);
                }
                map.remove(session_id);
            }
        }

        let candidates: Vec<&str> = match &self.python_override {
            Some(bin) => vec![bin.as_str()],
            None => vec!["python", "python3"],
        };

        let mut last_err = String::new();
        for bin in candidates {
            match spawn_repl_child(bin) {
                Ok(session) => {
                    let arc = Arc::new(Mutex::new(session));
                    let mut map = self.sessions.lock().await;
                    map.insert(session_id.to_string(), arc.clone());
                    return Ok(arc);
                }
                Err(err) => {
                    last_err = format!("failed to start '{bin}': {err}");
                }
            }
        }

        Err(format!("python REPL unavailable ({last_err})"))
    }
}

fn spawn_repl_child(python_bin: &str) -> std::io::Result<ReplSession> {
    let mut cmd = Command::new(python_bin);
    cmd.args(["-u", "-c", PYTHON_REPL_WORKER])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .kill_on_drop(true);

    let mut child = cmd.spawn()?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| std::io::Error::other("missing child stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| std::io::Error::other("missing child stdout"))?;

    Ok(ReplSession {
        child,
        stdin,
        stdout: BufReader::new(stdout),
    })
}

pub fn global_exec_manager() -> &'static ExecManager {
    static MANAGER: OnceLock<ExecManager> = OnceLock::new();
    MANAGER.get_or_init(ExecManager::new)
}

/// Compound Primitive 2 (`exec`): run Python code in the persistent stateful REPL session
/// and dispatch `parallel_tools` concurrently.
pub async fn exec(req: ExecRequest) -> Result<ExecResult> {
    global_exec_manager().exec(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn persistent_python_repl_preserves_variables_across_turns() {
        let manager = ExecManager::new();
        let sid = format!("sess-{}", uuid::Uuid::new_v4());

        let turn1 = manager
            .exec(ExecRequest {
                session_id: sid.clone(),
                code: "x = 21\ny = x * 2\nprint('turn1 ok')".into(),
                parallel_tools: Vec::new(),
                timeout_ms: 5000,
            })
            .await
            .unwrap();

        assert_eq!(turn1.exit_code, 0, "stderr: {}", turn1.stderr);
        assert_eq!(turn1.stdout.trim(), "turn1 ok");
        assert!(turn1.persisted_vars.contains(&"x".to_string()));
        assert!(turn1.persisted_vars.contains(&"y".to_string()));

        let turn2 = manager
            .exec(ExecRequest {
                session_id: sid.clone(),
                code: "z = y + 8\nz".into(),
                parallel_tools: Vec::new(),
                timeout_ms: 5000,
            })
            .await
            .unwrap();

        assert_eq!(turn2.exit_code, 0, "stderr: {}", turn2.stderr);
        assert_eq!(turn2.stdout.trim(), "50");
        assert!(turn2.persisted_vars.contains(&"z".to_string()));

        manager.close_session(&sid).await;
    }

    #[tokio::test]
    async fn parallel_tools_dispatch_concurrently_and_bind_to_python() {
        let manager = ExecManager::new();
        manager
            .register_tool(
                "add_one",
                Arc::new(|call| {
                    Box::pin(async move {
                        let n = call.args.get("n").and_then(|v| v.as_i64()).unwrap_or(0);
                        json!({ "value": n + 1 })
                    })
                }),
            )
            .await;

        let sid = format!("sess-{}", uuid::Uuid::new_v4());
        let res = manager
            .exec(ExecRequest {
                session_id: sid.clone(),
                code: "total = sum(r['output']['value'] for r in tool_results)\nprint(total)".into(),
                parallel_tools: vec![
                    ExecToolCall {
                        tool: "add_one".into(),
                        args: json!({"n": 10}),
                    },
                    ExecToolCall {
                        tool: "add_one".into(),
                        args: json!({"n": 20}),
                    },
                ],
                timeout_ms: 5000,
            })
            .await
            .unwrap();

        assert_eq!(res.exit_code, 0, "stderr: {}", res.stderr);
        assert_eq!(res.stdout.trim(), "32");
        assert!(res.persisted_vars.contains(&"total".to_string()));

        manager.close_session(&sid).await;
    }

    #[tokio::test]
    async fn missing_python_falls_back_gracefully() {
        let manager = ExecManager::with_python_bin("nonexistent-python-binary-xyz-999");
        let res = manager
            .exec(ExecRequest {
                session_id: "missing".into(),
                code: "print(1)".into(),
                parallel_tools: vec![ExecToolCall {
                    tool: "echo".into(),
                    args: json!({"ping": "pong"}),
                }],
                timeout_ms: 2000,
            })
            .await
            .unwrap();

        assert_ne!(res.exit_code, 0);
        assert!(res.stderr.contains("unavailable"));
        assert!(res.stdout.contains("pong"));
    }

    #[tokio::test]
    async fn timeout_kills_hung_repl_and_session_recovers_cleanly() {
        let manager = ExecManager::new();
        let sid = format!("sess-timeout-{}", uuid::Uuid::new_v4());

        let hung = manager
            .exec(ExecRequest {
                session_id: sid.clone(),
                code: "while True:\n    pass".into(),
                parallel_tools: Vec::new(),
                timeout_ms: 250,
            })
            .await
            .unwrap();

        assert_eq!(hung.exit_code, 124);
        assert!(hung.stderr.contains("timed out"));

        let recovered = manager
            .exec(ExecRequest {
                session_id: sid.clone(),
                code: "a = 7\na * 6".into(),
                parallel_tools: Vec::new(),
                timeout_ms: 5000,
            })
            .await
            .unwrap();

        assert_eq!(recovered.exit_code, 0);
        assert_eq!(recovered.stdout.trim(), "42");

        manager.close_session(&sid).await;
    }
}
