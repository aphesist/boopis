//! App-wide state: one gateway proxy per profile (created on first use), and which proxy each UI connection belongs to.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use crate::config::Limits;
use crate::endpoint::EndpointConfig;
use crate::error::{Error, Result};
use crate::gateway::{ConnectionId, Declare, Hub, LinkStatus};
use crate::hermes::Supervisor;

/// Called for every change of a profile's link status.
pub type StatusEmitter = Arc<dyn Fn(&str, &LinkStatus) + Send + Sync>;

/// Called once for each proxy when it is created, with the proxy and the question "does this profile use the free tier?".
pub type HubObserver = Arc<dyn Fn(&Arc<Hub>, Declare) + Send + Sync>;

/// Called once for each proxy when it is created, with the profile's key and the proxy: the local API listens to every
/// link from here (`ADR-0045`).
pub type HubCreated = Arc<dyn Fn(&str, &Arc<Hub>) + Send + Sync>;

/// The proxies and the connection index.
pub struct Hubs {
    observer: Option<HubObserver>,
    gate: Option<crate::endpoint::Gate>,
    created: Option<HubCreated>,
    supervisor: Arc<Supervisor>,
    limits: Limits,
    emitter: StatusEmitter,
    by_profile: Mutex<HashMap<String, Arc<Hub>>>,
    index: Mutex<HashMap<ConnectionId, String>>,
    next: AtomicU32,
}

impl Hubs {
    /// An empty set over `supervisor`.
    #[must_use]
    pub fn new(supervisor: Arc<Supervisor>, limits: Limits, emitter: StatusEmitter) -> Self {
        Self {
            observer: None,
            gate: None,
            created: None,
            supervisor,
            limits,
            emitter,
            by_profile: Mutex::new(HashMap::new()),
            index: Mutex::new(HashMap::new()),
            next: AtomicU32::new(1),
        }
    }

    /// Tell `observer` about every proxy created from now on.
    #[must_use]
    pub fn with_observer(mut self, observer: HubObserver) -> Self {
        self.observer = Some(observer);
        self
    }

    /// Make every proxy's link wait at `gate` before it dials (the host closes it while it replaces the gateway's code).
    #[must_use]
    pub fn with_gate(mut self, gate: crate::endpoint::Gate) -> Self {
        self.gate = Some(gate);
        self
    }

    /// Tell `created` about every proxy made from now on, with its profile's key.
    #[must_use]
    pub fn with_created(mut self, created: HubCreated) -> Self {
        self.created = Some(created);
        self
    }

    /// The proxy for a profile (`None` is the active one), created on first use.
    ///
    /// # Errors
    /// `InvalidInput` for a bad profile name.
    pub fn hub_for(&self, profile: Option<&str>) -> Result<(String, Arc<Hub>)> {
        let key = profile
            .filter(|p| !p.is_empty() && *p != "default")
            .unwrap_or("default")
            .to_owned();
        let mut hubs = self
            .by_profile
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        if let Some(h) = hubs.get(&key) {
            return Ok((key, h.clone()));
        }
        let endpoint = EndpointConfig::Local {
            profile: (key != "default").then(|| key.clone()),
        }
        .build(&self.supervisor, &self.limits)?;
        let endpoint: Arc<dyn crate::endpoint::Endpoint> = match &self.gate {
            Some(gate) => Arc::new(crate::endpoint::Gated::new(endpoint, gate.clone())),
            None => endpoint,
        };
        // The free tier works only for a client Hermes counts as its Desktop (a declaration on this link), so the link
        // makes it when, and only when, the user chose the free tier: asked again on every dial.
        let home = self
            .supervisor
            .environment()
            .profile_home((key != "default").then_some(key.as_str()))?;
        let declare: Declare = Arc::new(move || crate::setup::state::free_tier_chosen(&home));
        let hub = Arc::new(Hub::with_declaration(
            endpoint,
            self.limits.clone(),
            declare.clone(),
        ));
        if let Some(observe) = &self.observer {
            observe(&hub, declare);
        }
        if let Some(created) = &self.created {
            created(&key, &hub);
        }
        let (emit, name, mut rx) = (self.emitter.clone(), key.clone(), hub.watch());
        tokio::spawn(async move {
            loop {
                let status = rx.borrow_and_update().clone();
                emit(&name, &status);
                if rx.changed().await.is_err() {
                    return;
                }
            }
        });
        hubs.insert(key.clone(), hub.clone());
        Ok((key, hub))
    }

    /// A fresh connection id.
    #[must_use]
    pub fn next_id(&self) -> ConnectionId {
        self.next.fetch_add(1, Ordering::Relaxed)
    }

    /// Remember which profile a connection belongs to.
    pub fn register(&self, id: ConnectionId, profile_key: String) {
        self.index
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(id, profile_key);
    }

    /// Forget a connection and return its proxy.
    pub fn forget(&self, id: ConnectionId) -> Option<Arc<Hub>> {
        let key = self
            .index
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id)?;
        self.by_profile
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&key)
            .cloned()
    }

    /// The proxy a connection belongs to.
    ///
    /// # Errors
    /// `UnknownConnection`.
    pub fn route(&self, id: ConnectionId) -> Result<Arc<Hub>> {
        let key = self
            .index
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&id)
            .cloned()
            .ok_or(Error::UnknownConnection(id))?;
        self.by_profile
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(&key)
            .cloned()
            .ok_or(Error::UnknownConnection(id))
    }

    /// Close every UI connection: the main window's page is loading again (a reload, or the watchdog's recovery), so
    /// the connections the old page opened have no reader any more. Their queues would otherwise fill to the hard cap
    /// before they were dropped. The links to the gateway stay up.
    pub fn close_all_connections(&self) -> usize {
        let ids: Vec<ConnectionId> = self
            .index
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .keys()
            .copied()
            .collect();
        for id in &ids {
            if let Some(hub) = self.forget(*id) {
                hub.close(*id);
            }
        }
        ids.len()
    }

    /// The deepest any UI connection's queue went, across every proxy.
    #[must_use]
    pub fn outbox_peak(&self) -> u32 {
        self.by_profile
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
            .map(|h| {
                h.metrics()
                    .outbox_peak
                    .load(std::sync::atomic::Ordering::Relaxed)
            })
            .max()
            .unwrap_or(0)
    }

    /// Stop every proxy (app exit).
    pub fn shutdown(&self) {
        for h in self
            .by_profile
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .values()
        {
            h.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hermes::Environment;

    fn hubs() -> Hubs {
        let env = Environment {
            hermes_home: Some("/nonexistent".into()),
            ..Environment::default()
        };
        Hubs::new(
            Arc::new(Supervisor::new(env, Limits::default())),
            Limits::default(),
            Arc::new(|_, _| {}),
        )
    }

    #[tokio::test]
    async fn one_proxy_per_profile_and_connection_ids_are_unique() {
        let h = hubs();
        let (k1, a) = h.hub_for(None).unwrap();
        let (k2, b) = h.hub_for(Some("default")).unwrap();
        assert_eq!((k1.as_str(), k2.as_str()), ("default", "default"));
        assert!(Arc::ptr_eq(&a, &b));
        let (_, c) = h.hub_for(Some("nina")).unwrap();
        assert!(!Arc::ptr_eq(&a, &c));
        assert!(h.hub_for(Some("../x")).is_err());
        let (i1, i2) = (h.next_id(), h.next_id());
        assert_ne!(i1, i2);
        h.register(i1, "default".into());
        assert!(Arc::ptr_eq(&h.route(i1).unwrap(), &a));
        assert_eq!(
            h.route(i2).err().unwrap().code(),
            "hx.host.unknown_connection"
        );
        assert!(h.forget(i1).is_some());
        assert!(h.route(i1).is_err());
    }
}
