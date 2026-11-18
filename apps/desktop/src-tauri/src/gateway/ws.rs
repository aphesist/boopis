//! The WebSocket client: `tokio-tungstenite`, **no `Origin` header**, the ticket subprotocols, frame-size caps.
//! (A browser always sends `Origin`, which is why the UI never opens this socket itself.)

use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;

use super::link::{GatewayConn, Inbound, Outbound};
use crate::error::{Error, Result};
use crate::hermes::attach::{Dial, require_loopback};

/// Dial a gateway and return the link.
///
/// # Errors
/// `Unavailable` when the URL is not loopback, the TCP connect or the handshake fails, or the server picks a
/// subprotocol that was not offered.
pub async fn dial(
    dial: &Dial,
    max_frame: usize,
    timeout: std::time::Duration,
) -> Result<GatewayConn> {
    require_loopback(&dial.url)?;
    let started = std::time::Instant::now();
    let host = dial
        .url
        .host_str()
        .ok_or_else(|| Error::Unavailable("no host".into()))?
        .trim_matches(['[', ']'])
        .to_owned();
    let port = dial
        .url
        .port_or_known_default()
        .ok_or_else(|| Error::Unavailable("no port".into()))?;
    let mut request = dial
        .url
        .as_str()
        .into_client_request()
        .map_err(|e| Error::Unavailable(e.to_string()))?;
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        HeaderValue::from_str(&dial.subprotocols.join(", "))
            .map_err(|e| Error::Unavailable(e.to_string()))?,
    );
    debug_assert!(
        request.headers().get("Origin").is_none(),
        "the gateway refuses an Origin header"
    );
    let config = WebSocketConfig::default()
        .max_message_size(Some(max_frame))
        .max_frame_size(Some(max_frame));
    let work = async {
        let tcp = TcpStream::connect((host.as_str(), port)).await?;
        tcp.set_nodelay(true)?;
        tokio_tungstenite::client_async_with_config(request, tcp, Some(config))
            .await
            .map_err(|e| Error::Unavailable(format!("websocket handshake: {e}")))
    };
    let (ws, _response) = tokio::time::timeout(timeout, work)
        .await
        .map_err(|_| Error::Timeout("the websocket handshake"))??;
    let (sink, stream) = ws.split();
    let rx = stream.filter_map(|m| async move {
        match m {
            Ok(Message::Text(t)) => Some(Ok(Inbound::Text(t.as_str().to_owned()))),
            Ok(Message::Pong(_) | Message::Ping(_)) => Some(Ok(Inbound::Alive)),
            Ok(Message::Close(_)) => Some(Ok(Inbound::Closed)),
            Ok(Message::Binary(_)) => {
                Some(Err(Error::Ws("the gateway sent a binary frame".into())))
            }
            Ok(Message::Frame(_)) => None,
            Err(e) => Some(Err(Error::Ws(e.to_string()))),
        }
    });
    let tx = sink
        .sink_map_err(|e| Error::Ws(e.to_string()))
        .with(|o: Outbound| async move {
            Ok::<_, Error>(match o {
                Outbound::Text(t) => Message::text(t),
                Outbound::Ping => Message::Ping(Vec::new().into()),
            })
        });
    Ok(GatewayConn {
        rx: Box::pin(rx),
        tx: Box::pin(tx),
        attach: started.elapsed(),
    })
}

#[cfg(test)]
#[allow(clippy::result_large_err)] // tungstenite's handshake callback type
mod tests {
    use super::*;
    use crate::hermes::attach::EndpointInfo;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn dial_for(port: u16, ticket: &str) -> Dial {
        Dial {
            url: url::Url::parse(&format!("ws://127.0.0.1:{port}/api/ws")).unwrap(),
            subprotocols: vec![
                "hermes-gateway-v1".into(),
                format!("hermes-gateway-ticket.{ticket}"),
            ],
            endpoint: EndpointInfo::default(),
        }
    }

    #[tokio::test]
    async fn the_handshake_has_the_ticket_subprotocols_and_no_origin() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = tokio::spawn(async move {
            let (mut s, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 4096];
            let n = s.read(&mut buf).await.unwrap();
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            // Refuse the upgrade so the test only inspects the request.
            s.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
            head
        });
        let res = dial(
            &dial_for(port, "tkt_123-AB"),
            1 << 20,
            std::time::Duration::from_secs(5),
        )
        .await;
        assert!(res.is_err());
        let head = server.await.unwrap().to_ascii_lowercase();
        assert!(!head.contains("origin:"), "no Origin header: {head}");
        assert!(
            head.contains(
                "sec-websocket-protocol: hermes-gateway-v1, hermes-gateway-ticket.tkt_123-ab"
            ),
            "{head}"
        );
        assert!(head.starts_with("get /api/ws "), "{head}");
    }

    #[tokio::test]
    async fn frames_round_trip_and_close_is_reported() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (s, _) = listener.accept().await.unwrap();
            let cb = |_: &tokio_tungstenite::tungstenite::handshake::server::Request, mut r: tokio_tungstenite::tungstenite::handshake::server::Response| {
                r.headers_mut().insert("Sec-WebSocket-Protocol", HeaderValue::from_static("hermes-gateway-v1"));
                Ok(r)
            };
            let mut ws = tokio_tungstenite::accept_hdr_async(s, cb).await.unwrap();
            ws.send(Message::text(
                r#"{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready"}}"#,
            ))
            .await
            .unwrap();
            while let Some(Ok(m)) = ws.next().await {
                if let Message::Text(t) = m {
                    ws.send(Message::text(t.as_str())).await.unwrap();
                    ws.close(None).await.unwrap();
                    break;
                }
            }
        });
        let mut conn = dial(
            &dial_for(port, "t"),
            1 << 20,
            std::time::Duration::from_secs(5),
        )
        .await
        .unwrap();
        assert!(
            matches!(conn.rx.next().await, Some(Ok(Inbound::Text(t))) if t.contains("gateway.ready"))
        );
        conn.tx
            .send(Outbound::Text(
                r#"{"jsonrpc":"2.0","id":1,"method":"x"}"#.into(),
            ))
            .await
            .unwrap();
        assert!(
            matches!(conn.rx.next().await, Some(Ok(Inbound::Text(t))) if t.contains(r#""id":1"#))
        );
        assert!(matches!(conn.rx.next().await, Some(Ok(Inbound::Closed))));
    }

    #[tokio::test]
    async fn a_non_loopback_dial_is_refused_before_connecting() {
        let d = Dial {
            url: url::Url::parse("ws://203.0.113.5:9/api/ws").unwrap(),
            subprotocols: vec!["hermes-gateway-v1".into()],
            endpoint: EndpointInfo::default(),
        };
        assert!(
            dial(&d, 1024, std::time::Duration::from_millis(100))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn an_oversized_frame_ends_the_link_with_an_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (s, _) = listener.accept().await.unwrap();
            let cb = |_: &tokio_tungstenite::tungstenite::handshake::server::Request, mut r: tokio_tungstenite::tungstenite::handshake::server::Response| {
                r.headers_mut().insert("Sec-WebSocket-Protocol", HeaderValue::from_static("hermes-gateway-v1"));
                Ok(r)
            };
            let mut ws = tokio_tungstenite::accept_hdr_async(s, cb).await.unwrap();
            ws.send(Message::text("x".repeat(5000))).await.unwrap();
            let _ = ws.next().await;
        });
        let mut conn = dial(
            &dial_for(port, "t"),
            1000,
            std::time::Duration::from_secs(5),
        )
        .await
        .unwrap();
        assert!(matches!(conn.rx.next().await, Some(Err(_))));
    }
}
