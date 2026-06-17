# Connector Tool Search V0 Final Plan

Status: final implementation handoff plan.

Source documents:

- `docs/design/connector-tool-search-v0-synthesis.md` is the decision synthesis.
- `docs/design/connector-tool-search-v0.md` is a useful model draft, but this
  file is the plan to hand to an implementation agent.
- `docs/design/connector-tool-search-best-of-3.md` is research/archive material.

## 1. What We Are Building

Poolside Studio currently injects every enabled connector MCP server into normal
ACP chat startup. That means the agent sees all connector tools up front, even
when it only needs one Slack, GitHub, Linear, or Google tool later.

V0 replaces normal app chat connector injection with three app-bridge proxy
tools:

1. `search_connector_tools`
2. `get_connector_tool_details`
3. `call_connector_tool`

When the feature flag is enabled, normal app chat sessions still receive the
app-bridge MCP server, but they do not receive raw connector MCP server
descriptors. Connector tools become available through search, details, and call.

This is not Anthropic native `defer_loading`. This is a Studio-owned proxy.

## 2. User Outcomes

Users should experience faster normal chat startup and less tool clutter in the
agent context, while still being able to use connector tools on demand.

The agent should experience a clear progressive flow:

1. Search for a capability.
2. Inspect the exact tool schema.
3. Call the selected connector tool.

## 3. Success Metrics

These are the done conditions for the implementation branch. All must pass
before considering the flag default-on in a later PR.

| Metric                                 | Required condition                                                                                                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal app chat connector startup      | `0` connector MCP servers injected when `POOL_DESKTOP_CONNECTOR_TOOL_SEARCH=1`                                                                                                                     |
| App bridge connector tools             | Exactly these three connector-domain proxy tools are added when the flag is on; existing non-connector app-bridge tool gating is unchanged                                                         |
| Flag off / missing capability rollback | Existing renderer connector MCP injection behavior is unchanged when the flag/capability is false or absent; normal upgraded flag-on app still must not expose both raw connectors and proxy tools |
| Search response                        | Preserves `resultsShape`, `catalogVersion`, `searchedConnectors`, `warnings`, and `tools[].more.details`                                                                                           |
| Search compactness                     | `search_connector_tools` never returns full schemas                                                                                                                                                |
| Details response                       | Returns one sanitized `inputSchema`, `schemaHash`, `refreshedAt`, and `callTemplate`                                                                                                               |
| HTTP OAuth smoke                       | `search -> details -> call` works for one HTTP OAuth connector                                                                                                                                     |
| stdio/local smoke                      | `search -> details -> call` works for one stdio/local connector                                                                                                                                    |
| Headless/scheduled task paths          | Existing task connector injection and scheduled preflight behavior are unchanged                                                                                                                   |

## 4. Scope

V0 covers normal renderer-driven app chats through:

- `src/lib/acp/session/app-bridge-gateway.ts`

V0 does not change:

- `electron/tasks/headless-task-runner.ts`
- `electron/tasks/scheduled-task-run-lifecycle.ts`
- scheduled task connector preflight
- headless task connector MCP server descriptors
- disabled connector search
- connector setup UI
- semantic search
- persisted catalog cache
- provider-native tool references
- native dynamic tool activation

Do not claim this removes connector injection from all ACP sessions. It removes
connector injection from normal app chat startup only.

## 5. Existing Code Realities

These are verified from current code and must guide implementation.

### Normal Chat Startup

`src/lib/acp/session/app-bridge-gateway.ts`:

- `buildSessionMcpServers()` always provisions app bridge first.
- It currently calls `listEnabledConnectorMcpServers("session-build")` and
  appends all returned connector MCP servers.
- `prewarmEnabledConnectorMcpServers()` currently prewarms connector MCP server
  descriptors before session build.

Both paths need the same renderer-visible capability gate.

### Connector Tool Listing

`electron/connectors/service.ts`:

- `listConnectorTools(connectorId)` returns `ConnectorToolSummary[]`.
- `ConnectorToolSummary` only contains `name` and `description`.
- The private listing path has access to upstream MCP `Tool[]`, but strips
  schemas before returning summaries.

The catalog cannot be built correctly until a schema-bearing public discovery
API exists.

### Connector Tool Calling

`electron/connectors/relay-http-server.ts`:

- `callWarmConnectorTool()` already calls `warmSession.client.callTool(params)`.
- It retries once on unauthorized by invalidating the warm session and forcing
  refresh.
- It is private.

The app bridge proxy cannot call connector tools safely until a public
`ConnectorService.callConnectorTool()` API exists.

### App Bridge Tool Registration

`electron/mcp/http-server.ts` creates an `McpServer` and calls:

```ts
registerAllTools(server, ctx, options);
```

`electron/mcp/domains/index.ts` currently receives `PoolsideAppBridgeService`
and context helpers, but no connector dependencies.

The connector domain must receive dependencies through app bridge registration
options, not by importing global connector services.

## 6. Final Design Decisions

| Decision                     | Choice                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Feature flag                 | `POOL_DESKTOP_CONNECTOR_TOOL_SEARCH`, parsed by a shared helper and exposed synchronously in `DesktopHost.app.appBridge.capabilities` |
| Initial default              | Off                                                                                                                                   |
| App bridge dependency wiring | Pass optional `connectorDeps` through `PoolsideAppBridgeHttpServer` and `ToolRegistrationOptions`                                     |
| Catalog location             | `electron/connectors/tool-catalog-service.ts`                                                                                         |
| Domain location              | `electron/mcp/domains/connectors.ts`                                                                                                  |
| Catalog scope                | Enabled MCP-eligible connectors only                                                                                                  |
| Disabled connectors          | Not indexed in v0                                                                                                                     |
| Auth/discovery failures      | Returned as warnings for enabled connectors                                                                                           |
| Search                       | Lexical search over tool name, description, connector name, schema property names                                                     |
| Local argument validation    | Deferred in v0; rely on upstream MCP errors                                                                                           |
| Call identity                | base64url-encoded canonical JSON `toolId` payload `{ "connectorId": "...", "toolName": "..." }`                                       |
| `schemaHash`                 | `sha256(canonicalJson(sanitizedInputSchema))` as lowercase hex                                                                        |
| `catalogVersion`             | `sha256(canonicalJson(sorted[{ connectorId, toolName, schemaHash }]))` as lowercase hex                                               |
| Cache                        | In-memory, lazy per connector, explicit invalidation                                                                                  |
| Task paths                   | Explicitly unchanged                                                                                                                  |

## 7. Implementation Phases

Implement in this order. Each phase should be testable before moving on.

### Phase 0: Verify Local Seams

No behavior change.

This phase is mandatory. Do not start service/catalog code until the preflight
answers are written into a checked-in artifact: either append a `Phase 0 Results`
section to this plan or create
`docs/plans/connector-tool-search-v0-phase0-results.md`. Later beads must treat
that artifact as the source for relay eligibility, Google path, robot-session
behavior, empty-query behavior, and exact test files.

Answer these before coding the main implementation:

1. Confirm the exact preload/desktop host shape used by `getDesktopHost()`.
2. Confirm where to add a renderer-visible app capability type.
3. Confirm whether `ConnectorRelayHttpServer.callWarmConnectorTool()` can be
   safely exposed without prior `createMcpServerDescriptor()` registration.
4. Confirm whether Google Workspace connectors work through the same
   `buildProbeTransport()` path for list and call.
5. Confirm existing test files for:

- connector service listing;
- app bridge HTTP tools;
- session MCP server assembly;
- headless task connector resolution.

Required preflight output:

| Question               | Required answer before Phase 1                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| Capability surface     | Exact `DesktopHost` field and whether it is sync or async                                   |
| Relay call proof       | Whether relay warm-session calls need `createMcpServerDescriptor()` registration first      |
| Google path proof      | Whether Google Workspace list/call works through the same `ConnectorService` transport path |
| Robot session decision | Whether robot bridge sessions receive proxy tools in v0                                     |
| Empty query decision   | Confirm empty query is invalid in v0                                                        |
| Existing tests         | Exact test file names to extend                                                             |

Preflight decisions for this plan:

- Capability surface: add a synchronous
  `DesktopHost.app.appBridge.capabilities.connectorToolSearchEnabled` boolean in
  `src/lib/desktop/host.ts` and `electron/preload.ts`. `prewarmEnabledConnectorMcpServers()`
  is synchronous, so the renderer cannot depend on an asynchronous capability
  lookup for this decision.
- Flag source: parse `POOL_DESKTOP_CONNECTOR_TOOL_SEARCH` with the same helper
  in main and preload. This keeps registration and renderer gating on one env
  contract while preserving synchronous prewarm behavior.
- Capability absence: treat as `false` and inject raw connectors. Tests must
  also prove the upgraded app does not produce both raw connectors and proxy
  tools when the flag is on.
- Robot session decision: v0 does not expose connector proxy tools to robot
  bridge sessions. Phase 0 should confirm the registration test seam, not reopen
  this scope decision.
- Empty query decision: invalid in v0.

Expected output of this phase is either no code, or tiny test/typing scaffolding
only. Do not broaden scope based on discoveries unless a discovered seam blocks
the v0 contract.

### Phase 1: Add Schema-Bearing Connector Discovery

File:

- `electron/connectors/service.ts`

Add a public method:

```ts
export type ConnectorToolCatalogConnector = {
  connectorId: string;
  connectorName: string;
  templateId: ConnectorRecord["templateId"];
};

export type ConnectorToolDefinition = ConnectorToolCatalogConnector & {
  tool: Tool;
};

async listEnabledConnectorToolCatalogConnectors(): Promise<ConnectorToolCatalogConnector[]>;

async listConnectorToolDefinitions(
  connectorId: string,
): Promise<ConnectorToolDefinition[]>;
```

Requirements:

- `connectorId` must resolve through the existing connector store.
- Unknown connector id fails clearly.
- Config-only connectors return `[]`.
- Disabled connectors fail clearly, or are skipped by caller before discovery.
  Prefer fail clearly in the service and filter in the catalog.
- Full upstream `Tool[]` must be sanitized with
  `sanitizeMcpToolsForPoolCompatibility()`.
- Existing `listConnectorTools()` behavior remains unchanged.
- Existing connection status writes remain consistent with current listing
  behavior.
- Existing OAuth unauthorized retry behavior is preserved.
- The new agent-facing discovery API must be non-interactive for OAuth and auth
  header resolution. It must pass `interactive: false`, never trigger
  `openExternal`, and surface missing authorization as a clear auth-required
  failure for the catalog to convert into `connector_auth_required` warnings or
  errors.
- `listEnabledConnectorToolCatalogConnectors()` must reuse the same
  enabled/MCP-eligible predicate as `listEnabledMcpServers()` and must return only
  the safe `ConnectorToolCatalogConnector` shape above. Do not return
  `ConnectorRecord`, because records can contain headers, env vars, bearer tokens,
  OAuth client fields, and other secrets. Do not duplicate config-only or
  MCP-eligibility predicates in `ConnectorToolCatalogService`.

Implementation shape:

- Extract a private full-tool listing method from the existing
  `listToolsForConnectorOnce()` path.
- Have the old summary method map full sanitized tools to
  `{ name, description }`.
- Avoid duplicate transport/auth code.

Anti-goal:

- Do not return raw unsanitized schemas from the new public API.

### Phase 2: Add Public Connector Tool Call API

Files:

- `electron/connectors/service.ts`
- `electron/connectors/relay-http-server.ts`

Add to `ConnectorService`:

```ts
async callConnectorTool(input: {
  connectorId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}): Promise<CallToolResult>;
```

Requirements:

- Validate connector exists.
- Reject disabled connectors.
- Reject config-only connectors.
- Reject empty `toolName`.
- Relay-eligible connectors reuse relay warm-session call logic.
- Non-relay connectors use an ephemeral MCP `Client` in v0.
- OAuth unauthorized retry is preserved.
- Agent-facing calls are non-interactive. `callConnectorTool()` must pass
  `interactive: false` through token/header resolution, never trigger
  `openExternal`, and return/throw an actionable `connector_auth_required`
  error when authorization is missing. Existing `connectConnector()` and
  `testConnector()` may remain interactive.
- The method returns the upstream MCP `CallToolResult`.
- `ConnectorService` owns transport construction and auth details.

Transport decision table:

| Connector shape                                        | Discovery path                                                                       | Call path                                                                 | Retry/auth behavior                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `transport: "stdio"`                                   | Ephemeral `Client` using existing `buildProbeTransport()`                            | Ephemeral `Client.callTool()`                                             | No OAuth; close client in `finally`                                   |
| `transport: "http"`, `authMode: "none"`                | Ephemeral `Client` using existing HTTP transport                                     | Ephemeral `Client.callTool()`                                             | No auth retry                                                         |
| `transport: "http"`, `authMode: "bearer"`              | Ephemeral `Client` using existing header resolution                                  | Ephemeral `Client.callTool()`                                             | No OAuth retry; surface upstream auth errors                          |
| `transport: "http"`, direct OAuth                      | Existing OAuth transport/header path with `interactive: false`                       | Ephemeral `Client.callTool()` unless Phase 0 proves relay is already used | Retry once on unauthorized via token invalidation/refresh; no browser |

[truncated for eval fixture]
