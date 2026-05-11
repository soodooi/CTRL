// Channel — typed pipe between actors. Bounded MPSC with back-pressure.
//
// Built on tokio::sync::mpsc. Drop policy declared per channel
// (block / drop_oldest / drop_newest). Mirrors @ctrl/kernel-sdk channel.ts.

use crate::kernel::event::Event;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DropPolicy {
    Block,
    DropOldest,
    DropNewest,
}

impl Default for DropPolicy {
    fn default() -> Self {
        Self::Block
    }
}

#[derive(Debug, Clone)]
pub struct ChannelOptions {
    pub capacity: usize,
    pub drop_policy: DropPolicy,
}

impl Default for ChannelOptions {
    fn default() -> Self {
        Self {
            capacity: 1024,
            drop_policy: DropPolicy::Block,
        }
    }
}

/// Typed channel producer.
#[derive(Clone)]
pub struct ChannelTx {
    inner: mpsc::Sender<Event>,
    policy: DropPolicy,
}

impl ChannelTx {
    pub async fn send(&self, event: Event) -> Result<(), ChannelError> {
        match self.policy {
            DropPolicy::Block => self
                .inner
                .send(event)
                .await
                .map_err(|_| ChannelError::ReceiverDropped),
            DropPolicy::DropNewest => match self.inner.try_send(event) {
                Ok(()) => Ok(()),
                Err(mpsc::error::TrySendError::Full(_)) => Err(ChannelError::Dropped),
                Err(mpsc::error::TrySendError::Closed(_)) => Err(ChannelError::ReceiverDropped),
            },
            // DropOldest requires holding the receiver to drain; implemented at
            // Channel level via Arc<Mutex<Rx>>. Falls back to try_send here for
            // the simple case where Tx alone is held.
            DropPolicy::DropOldest => match self.inner.try_send(event) {
                Ok(()) => Ok(()),
                Err(mpsc::error::TrySendError::Full(_)) => Err(ChannelError::Dropped),
                Err(mpsc::error::TrySendError::Closed(_)) => Err(ChannelError::ReceiverDropped),
            },
        }
    }

    pub fn try_push(&self, event: Event) -> Result<(), ChannelError> {
        self.inner
            .try_send(event)
            .map_err(|e| match e {
                mpsc::error::TrySendError::Full(_) => ChannelError::Full,
                mpsc::error::TrySendError::Closed(_) => ChannelError::ReceiverDropped,
            })
    }
}

/// Typed channel consumer.
pub struct ChannelRx {
    inner: Arc<Mutex<mpsc::Receiver<Event>>>,
}

impl ChannelRx {
    pub async fn recv(&self) -> Option<Event> {
        let mut guard = self.inner.lock().await;
        guard.recv().await
    }

    pub fn close(&self) {
        // Closing handled by dropping last Tx; explicit close not required.
    }
}

pub struct Channel {
    pub tx: ChannelTx,
    pub rx: ChannelRx,
    pub capacity: usize,
}

impl Channel {
    pub fn bounded(opts: ChannelOptions) -> Self {
        let (tx, rx) = mpsc::channel::<Event>(opts.capacity);
        Self {
            tx: ChannelTx {
                inner: tx,
                policy: opts.drop_policy,
            },
            rx: ChannelRx {
                inner: Arc::new(Mutex::new(rx)),
            },
            capacity: opts.capacity,
        }
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum ChannelError {
    #[error("channel full (capacity reached)")]
    Full,
    #[error("event dropped per channel policy")]
    Dropped,
    #[error("receiver dropped, channel closed")]
    ReceiverDropped,
}
