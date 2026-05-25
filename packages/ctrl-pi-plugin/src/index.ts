// @ctrl/pi-plugin — public entrypoints.
//
// Two consumers:
//   1. `ctrl-pi-mcp` bin — launches the MCP server (see ./bin/ctrl-pi-mcp.ts).
//   2. Tests / embedded use — programmatic startMcpServer() + PiBridge.

export { startMcpServer, type RunningServer, type ServerConfig } from './mcp-server.ts';
export {
  PiBridge,
  type BridgeStatus,
  type BridgeTransport,
  type ChatMessage,
  type ChatRequest,
  type ChatChunk,
  type ChatFinal,
  type StreamCallbacks,
} from './pi-bridge.ts';
export { detectPi, PiNotFoundError, type PiBinary } from './pi-detect.ts';
