// Adapters — concrete implementations of ports + protocol translation.
// Inbound: drives the application from the outside (Tauri commands).
// Outbound: the application drives the outside (OS APIs, IPC, clock).

pub mod inbound;
pub mod outbound;
