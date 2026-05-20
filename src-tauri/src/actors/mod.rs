// L3 Userland actors — keycaps + hardware sources + LLM workers + OAuth flows.
//
// Each actor implements kernel::Actor trait. Manifest declares capability,
// kernel scheduler spawns + routes events. P2.5 stage: skeleton wrappers
// around existing use_cases. P5+: full actor-driven keycap execution.

pub mod keycap_actor;
// ADR-010 well-known actor subclasses
pub mod mcp_server_actor;
// SubprocessActor relocated to `kernel::subprocess_actor` per ADR-012.

pub use keycap_actor::KeycapActor;
pub use mcp_server_actor::McpServerActor;
