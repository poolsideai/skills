# MCP Apps UI Rendering Plan

> [!WARNING]
> This plan was identified as out of date on 2026-05-10. It is retained for
> historical context only. Do **not** implement from this plan or claim the
> related beads unless the plan and bead graph are revalidated or replaced.
>
> Related deferred beads: `bd-1jxk`, `bd-ln4o`, `bd-fins`, `bd-czqi`,
> `bd-n51p`, `bd-qj2m`, `bd-ehzs`.

Status: outdated / do not implement. Historical plan only; related beads have
been deferred.

## Goal

Make Poolside Studio a real MCP Apps host for the CustomHarness Smithers
workbench MCP server at `/Users/ben/code/custom-harness`.

Product default: chat shows a compact MCP App launcher/status card, and the
actual iframe runs in a dedicated Poolside MCP App Viewer pane tied to the
originating chat tool call. Do not put a full workflow/node editor directly in
the transcript by default.

This is not a generic "render some HTML from MCP" feature. The V1 should follow
`modelcontextprotocol/ext-apps` `v1.7.1` / SEP-1865 (`2026-01-26`) semantics:

- host advertises MCP Apps support with extension id
  `io.modelcontextprotocol/ui`;
- server exposes tools with `_meta.ui.resourceUri` pointing at a `ui://`
  resource;
- host fetches `text/html;profile=mcp-app` via `resources/read`;
- host renders the View in a sandboxed iframe;
- View connects back with MCP JSON-RPC over `postMessage`;
- host uses `@modelcontextprotocol/ext-apps/app-bridge` to handle the MCP Apps
  lifecycle, tool data delivery, and app-initiated MCP calls.

## Actual sources used for this plan

MCP Apps repo cloned/read from:

```txt
https://github.com/modelcontextprotocol/ext-apps
/tmp/pi-github-repos/modelcontextprotocol/ext-apps
```

Spec/docs/source read:

- `README.md`
- `docs/overview.md`
- `docs/quickstart.md`
- `docs/patterns.md`
- `docs/csp-cors.md`
- `docs/testing-mcp-apps.md`
- `specification/2026-01-26/apps.mdx`
- `src/spec.types.ts`
- `src/app.ts`
- `src/app-bridge.ts`
- `src/message-transport.ts`
- `src/server/index.ts`
- `examples/basic-host/src/implementation.ts`
- `examples/basic-host/src/sandbox.ts`

CustomHarness files read:

- `/Users/ben/code/custom-harness/package.json`
- `/Users/ben/code/custom-harness/src/server.ts`
- `/Users/ben/code/custom-harness/src/mcp/workbenchApp.ts`
- `/Users/ben/code/custom-harness/docs/feedback/mcp-apps-ui-layer-research-2026-05-09.md`

CustomHarness-side agent review:

- Intercom review with the CustomHarness session confirmed that Poolside should
  implement generic MCP Apps hosting, not a CustomHarness artifact protocol.
- Follow-up review recommended chat card → dedicated Poolside MCP App Viewer
  pane as the product default, with inline iframe only as debug/fallback.
- Follow-up iframe/WebContentsView research recommended V1 viewer rendering use
  a sandboxed iframe + `AppBridge`/`PostMessageTransport`; do not ask
  CustomHarness for a container-specific "webview mode". Avoid Electron's
  `<webview>` tag for product V1; consider `WebContentsView` only as a later
  host-side hardening/control path.

Poolside files read:

- `docs/architecture.md`
- `docs/golden-principles.md`
- `docs/app-bridge-mcp.md`
- `electron/connectors/relay-http-server.ts`
- `electron/connectors/service.ts`
- `electron/ipc/register-handlers.ts`
- `electron/preload.ts`
- `src/lib/desktop/host.ts`
- `src/app/shell/shell.svelte`
- `src/app/shell/layout/chat-pane.svelte`
- `src/features/chat/components/tool-call-block.svelte`
- `src/lib/acp/tool-call-presentation.ts`

## CustomHarness target contract

CustomHarness already uses the real MCP Apps SDK:

```json
"@modelcontextprotocol/ext-apps": "1.7.1",
"@modelcontextprotocol/sdk": "1.29.0"
```

Run target:

```bash
cd /Users/ben/code/custom-harness
PORT=4324 bun src/server.ts --project /Users/ben/code/custom-harness --workflow plan-fanout
```

Poolside connector URL:

```txt
http://localhost:4324/mcp
```

### Model-visible app launcher

CustomHarness registers:

```txt
open_workflow_workbench
```

with:

```ts
_meta: {
  ui: {
    resourceUri: "ui://custom-harness/workbench.html";
  }
}
```

Tool result shape:

- `content`: text fallback for non-UI hosts;
- `structuredContent`: bootstrap state for the workbench;
- `isError`: present on failure.

V1 `structuredContent` decision:

- Keep the full initial rendered graph in `structuredContent.graph` for the
  first Poolside MCP App Viewer milestone. This is intentional for fast iframe
  hydration via `app.ontoolresult`, simpler lifecycle debugging, and useful
  non-UI fallback while host support is new.
- Also add compact card-safe fields so Poolside does not depend on or render the
  full graph in the transcript:

  ```ts
  type OpenWorkflowWorkbenchStructuredContentV1 = {
    contractVersion: 1;
    ok: boolean;
    launch: {
      title: string;
      subtitle?: string;
      status: "ready" | "empty" | "error" | "verification_failed" | "loading";
      viewId: string;
      resourceUri: "ui://custom-harness/workbench.html";
    };
    project?: {
      projectRoot?: string;
      label?: string;
      defaultWorkflowId?: string;
    };
    workflow?: { id?: string; title?: string; path?: string };
    graphSummary?: {
      title?: string;
      nodeCount: number;
      edgeCount: number;
      defaultSelectedNodeId?: string;
      hasErrors?: boolean;
    };
    graph?: RenderGraph;
    graphHydration?: {
      included: boolean;
      truncated: boolean;
      reason?: "ok" | "too_large" | "error";
      bytes?: number;
      nodeCount?: number;
      edgeCount?: number;
    };
    capabilities?: {
      canRenderGraph: boolean;
      canCreateWorkflow: boolean;
      canEditSource: boolean;
      canStartRun: boolean;
      canInspectRuns: boolean;
    };
    error?: {
      code: string;
      message: string;
      retryable?: boolean;
      actionLabel?: string;
    };
  };
  ```

- Poolside chat cards use `launch`, `workflow`, `graphSummary`,
  `graphHydration`, and `error` only; never render/diffuse `graph` JSON in the
  chat card.
- CustomHarness app treats `graph` as optional. If it is absent, truncated, or
  stale, it calls app-only `ch_workflow_graph_render`.
- Put full `.tsx` source behind app-only source tools, not in
  `open_workflow_workbench` `structuredContent`.
- V1 cut line: do not block the first Poolside viewer demo on graph payload
  caps or truncation machinery. It is acceptable to include the current full
  graph exactly as-is while adding compact `launch`/`graphSummary` fields and
  making the chat card ignore `graph`.
- Fast-follow guardrail: if serialized graph JSON gets large, start around a
  250 KB cap; omit/truncate `graph`, set `graphHydration.truncated = true`, keep
  `graphSummary`, and let the iframe fetch the full graph app-only.
- Later, if graph payload size/model-context noise becomes painful, remove or
  deprecate `graph` while keeping the compact `launch`/`graphSummary` contract.

### Shared UI resource

CustomHarness registers:

```txt
ui://custom-harness/workbench.html
```

with MIME:

```txt
text/html;profile=mcp-app
```

and returns HTML from `mcpWorkbenchHtml()` in `resources/read`.

### App-only tools required for V1

The current CustomHarness View calls these app-only MCP tools through
`app.callServerTool(...)`:

- `ch_workflows_list`
- `ch_workflow_graph_render`
- `ch_workflow_create_from_prompt`

CustomHarness marks them with:

```ts
_meta: {
  ui: {
    visibility: ["app"];
  }
}
```

Poolside must hide those tools from the agent-facing `tools/list`, but allow the
rendered CustomHarness iframe to call them through the same MCP server
connection.

### View-side SDK behavior Poolside must support

`src/mcp/workbenchApp.ts` creates a real MCP App:

```ts
const app = new App(
  { name: "CustomHarness Workbench", version: "0.1.0" },
  { availableDisplayModes: ["inline", "fullscreen"] },
);
```

The View uses:

- `app.ontoolresult = ...` before `app.connect()`;
- `app.onhostcontextchanged = ...`;
- `app.onerror = ...`;
- `await app.connect()`;
- `app.getHostContext()`;
- `app.callServerTool({ name: "ch_workflows_list", arguments: {} })`;
- `app.callServerTool({ name: "ch_workflow_graph_render", arguments: ... })`;
- `app.callServerTool({ name: "ch_workflow_create_from_prompt", arguments: ... })`;
- `app.requestDisplayMode({ mode })`.

Therefore V1 Poolside host support must include:

- `ui/initialize` request handling through `AppBridge`;
- `ui/notifications/initialized` handling;
- host-to-view `ui/notifications/tool-input`;
- host-to-view `ui/notifications/tool-result`;
- view-to-host `tools/call`;
- view-to-host `ui/request-display-mode`;
- host-to-view `ui/notifications/host-context-changed` for display-mode changes;
- view-to-host `ui/notifications/size-changed` for iframe height.

`ui/message`, `ui/update-model-context`, file downloads, sampling, prompts, and
resource templates can be explicitly unsupported in V1 unless CustomHarness
starts using them.

## Spec-backed protocol facts

### Extension capability negotiation

MCP Apps extension id:

```txt
io.modelcontextprotocol/ui
```

Host client initialize capabilities must include:

```json
{
  "extensions": {
    "io.modelcontextprotocol/ui": {
      "mimeTypes": ["text/html;profile=mcp-app"]
    }
  }
}
```

The ext-apps server helper is `getUiCapability(clientCapabilities)`. Servers
may register UI-enhanced tools only when this capability is present, so Poolside
must advertise it from the relay's upstream warm MCP client.

### Resource format

UI resources:

- use `ui://` URI scheme;
- are read using MCP `resources/read`;
- V1 MIME is exactly `text/html;profile=mcp-app` (`RESOURCE_MIME_TYPE`);
- content is provided as either `text` HTML or base64 `blob` HTML;
- UI metadata belongs on the resource content item `_meta.ui`, with listing-level
  metadata from `resources/list` as fallback.

Resource UI metadata shape from `src/spec.types.ts`:

```ts
type McpUiResourceMeta = {
  csp?: {
    connectDomains?: string[];
    resourceDomains?: string[];
    frameDomains?: string[];
    baseUriDomains?: string[];
  };
  permissions?: {
    camera?: {};
    microphone?: {};
    geolocation?: {};
    clipboardWrite?: {};
  };
  domain?: string;
  prefersBorder?: boolean;
};
```

### Tool metadata and visibility

Tool UI linkage:

```ts
_meta: {
  ui?: {
    resourceUri?: string;
    visibility?: Array<"model" | "app">;
  };
  "ui/resourceUri"?: string; // deprecated fallback
}
```

Rules:

- `visibility` defaults to `["model", "app"]` when omitted.
- Tools without `model` visibility must be omitted from the agent-facing
  `tools/list`.
- Model-originated relay `tools/call` must also reject tools without `model`
  visibility. Hiding app-only tools from `tools/list` is not sufficient.
- App-originated `tools/call` must be rejected unless the target tool includes
  `app` visibility.
- App calls are scoped to the same MCP server connection; cross-server app-only
  calls are blocked.

Use ext-apps helpers where they fit:

```ts
import {
  RESOURCE_MIME_TYPE,
  getToolUiResourceUri,
  isToolVisibilityAppOnly,
  isToolVisibilityModelOnly,
  buildAllowAttribute,
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
```

Poolside still needs a small wrapper for the default case because the package
helpers expose model-only/app-only predicates, while Poolside needs
`isModelVisibleTool()` and `isAppCallableTool()` with the default
`["model", "app"]` behavior.

### View-host transport

MCP Apps uses MCP JSON-RPC 2.0 over `window.postMessage`. The ext-apps SDK
provides:

- View side: `App` from `@modelcontextprotocol/ext-apps`;
- Host side: `AppBridge` from `@modelcontextprotocol/ext-apps/app-bridge`;
- transport: `PostMessageTransport`.

`PostMessageTransport` validates `event.source` and sends with `postMessage(...,
"*")`. With `srcdoc` / sandboxed iframes the origin may be opaque; source
validation is the important V1 check.

### Initialize handshake

The View sends:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "ui/initialize",
  "params": {
    "appInfo": { "name": "...", "version": "..." },
    "appCapabilities": { "availableDisplayModes": ["inline", "fullscreen"] },
    "protocolVersion": "2026-01-26"
  }
}
```

`AppBridge` responds with `McpUiInitializeResult`:

```ts
type McpUiInitializeResult = {
  protocolVersion: string;
  hostInfo: Implementation;
  hostCapabilities: McpUiHostCapabilities;
  hostContext: McpUiHostContext;
};
```

For CustomHarness V1, Poolside host capabilities should include at least:

```ts
{
  openLinks: {},
  serverTools: {},
  serverResources: {},
  logging: {},
}
```

Do not advertise `message`, `updateModelContext`, `downloadFile`, or `sampling`
until implemented.

Host context should include at least:

```ts
{
  theme: "light" | "dark",
  platform: "desktop",
  displayMode: "inline",
  availableDisplayModes: ["inline", "fullscreen"],
  containerDimensions: { maxHeight: 1200 },
  userAgent: "poolside-studio",
  styles: { variables: { ...Poolside theme variables if available } },
}
```

### Required notification ordering

The host must be listening before the View can send `ui/initialize`. For direct
V1 iframe rendering, that means attaching an empty iframe and connecting
`PostMessageTransport` before setting `srcdoc`:

1. Create/attach iframe or sandbox target so `contentWindow` exists.
2. Register `AppBridge` handlers and hook `oninitialized`.
3. `AppBridge.connect(new PostMessageTransport(...))`.
4. Load/render the View HTML (`iframe.srcdoc` for direct V1, or
   `sendSandboxResourceReady` for the Phase 6 sandbox proxy).
5. View sends `ui/initialize`.
6. Host responds.
7. View sends `ui/notifications/initialized`.
8. Host sends `ui/notifications/tool-input` exactly once.
9. Host sends `ui/notifications/tool-result` after tool input.

Do not send tool input/result before `AppBridge.oninitialized` fires.

### Display mode

CustomHarness calls `app.requestDisplayMode({ mode })`. V1 should implement
`AppBridge.onrequestdisplaymode`:

- accept `inline` and `fullscreen`;
- return the actual mode in `{ mode }`;
- update `hostContext.displayMode` and notify the View with
  `sendHostContextChange({ displayMode: mode })`;
- if Poolside does not implement a real fullscreen surface yet, return
  `{ mode: "inline" }` and show a small UI message. Prefer an implementation
  that expands the MCP App Viewer pane/modal, never the chat row.

### Teardown

Before unmounting a rendered app, host should call:

```ts
await appBridge.teardownResource({});
```

Then close the transport/dispose the Electron app session. In V1 this should be
best-effort with a short timeout so viewer close or conversation switching does
not hang.

## V1 architecture

```txt
ACP runtime
  -> Poolside connector relay MCP server
    -> CustomHarness MCP server (http://localhost:4324/mcp)

Renderer chat UI
  -> ToolCallBlock sees completed connector tool call
  -> MCP App launch card resolves app capability/launch state lazily
  -> resolveToolApp(input) IPC
  -> Electron MCP Apps service
    -> map connector server name to connector id
    -> relay warm session allToolsByName lookup
    -> getToolUiResourceUri(tool)
    -> relay client.readResource({ uri })
  -> Renderer receives ResolvedMcpApp launch state
  -> Chat transcript shows compact launcher/status card
  -> User opens/focuses Poolside MCP App Viewer pane
  -> Viewer pane renders sandboxed iframe
  -> AppBridge + PostMessageTransport handle MCP Apps lifecycle
  -> AppBridge manual handlers call IPC with appId
  -> Electron validates appId + same connector + tool visibility
  -> relay warm client proxies tools/call/resources/read/list
```

Key design points:

- Use `@modelcontextprotocol/ext-apps/app-bridge`; do not hand-roll the Apps
  JSON-RPC protocol.
- Product default is card → dedicated MCP App Viewer pane. A full iframe inside
  the chat transcript is debug/fallback only.
- Keep the viewer tied to the originating tool call result, not just the
  connector. CustomHarness hydrates from the original `open_workflow_workbench`
  `structuredContent`, so reopening the viewer must resend that launch result or
  rehydrate from equivalent saved launch state.
- Create `AppBridge` with `client = null` and manual handlers. The default
  auto-forwarding path in `AppBridge(client, ...)` would not enforce Poolside's
  connector/app-id visibility checks.
- The relay remains the only code that talks to upstream connector URLs or holds
  connector auth material.
- Renderer/iframe never receives connector auth headers/tokens.
- V1 renders a direct sandboxed iframe in the viewer pane for Electron desktop.
  This matches the MCP Apps docs and ext-apps `AppBridge` examples.
- Do not ask MCP Apps servers for an iframe/webview/WebContentsView variant.
  Servers should provide standard `text/html;profile=mcp-app` resources; the
  host owns the render-container decision.
- Do not use Electron's `<webview>` tag for product V1. Electron recommends
  iframe or `WebContentsView` alternatives, and `<webview>` requires enabling a
  disabled-by-default tag with additional stability/event-routing concerns.
- If direct iframe rendering fails against the SDK or CSP in practice, use the
  ext-apps `examples/basic-host/src/sandbox.ts` double-iframe proxy pattern as
  the fallback implementation, not a custom protocol.
- If Poolside later needs stronger isolation/control than iframe can provide,
  evaluate `WebContentsView` as a host-side implementation detail. Expect more
  main/renderer coordination because it is not a DOM iframe with
  `contentWindow` for `PostMessageTransport`.

## Poolside implementation phases

### Phase 0 — prove the exact CustomHarness/AppBridge contract first

No Poolside behavior change and no Poolside dependency changes.

- [ ] Run CustomHarness at `http://localhost:4324/mcp`.
- [ ] Run ext-apps `examples/basic-host` against it:

  ```bash
  cd /tmp/pi-github-repos/modelcontextprotocol/ext-apps
  npm install
  cd examples/basic-host

[truncated for eval fixture]
