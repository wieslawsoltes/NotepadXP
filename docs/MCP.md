# MCP and in-page automation

## Transports

`node mcp/server.mjs` starts the source app, an authenticated browser command bridge, and the Streamable HTTP endpoint on `http://127.0.0.1:8787/mcp` by default. `--stdio` additionally accepts newline-delimited UTF-8 JSON-RPC on stdin and emits protocol messages only on stdout. Human-readable startup messages go to stderr.

Supported negotiated revisions: `2025-11-25`, `2025-06-18`, `2025-03-26`. An unsupported version is answered with the supported `2025-11-25` revision; clients must decide whether they can negotiate that version. The server is not a 2026 protocol implementation.

The HTTP transport returns JSON to POST requests. GET `/mcp` returns 405 because no unsolicited SSE stream is offered; this response is permitted by the pinned transport specification. This server does not implement the deprecated separate-endpoint HTTP+SSE transport, OAuth discovery, subscriptions, resumable streams, or sampling.

HTTP requests require `Authorization: Bearer <token>`. POST requests also require `Content-Type: application/json` and `Accept: application/json, text/event-stream`. Send `initialize`, keep `Mcp-Session-Id` from the response, send `notifications/initialized`, and include session ID plus negotiated `MCP-Protocol-Version` on subsequent requests. DELETE `/mcp` ends a session.

Use `NOTEPAD_PORT` or `--port` to choose a port. Tokens are random 32-byte hexadecimal values unless `NOTEPAD_TOKEN` is explicitly set (16–512 characters required). Do not reuse the documentation's placeholders as secrets. `node --input-type=module -e "import crypto from 'node:crypto'; console.log(crypto.randomBytes(32).toString('hex'))"` generates a suitable independent token.

## Authorization flow

Open the full URL printed by the **same process** that the client uses. The token in the fragment is captured into sessionStorage and removed from the address bar. Help → AI Agent Control offers read-only inspection or full control. Enable Control pairs the specific tab and starts its authenticated poll loop. Disable Control revokes that tab and outstanding operations.

A separate per-tab pairing secret protects poll/result endpoints and is not returned by `app_list_tabs`. The server enforces read-only grants independently of UI controls. Explicitly authorized agents can read sensitive text; the local app cannot control what those agents subsequently do with it. Treat a granted full-control agent as able to edit or discard document contents, subject to the API's revision and discard flags.

Tokens in stderr and sessionStorage are secrets. Anyone controlling the local process or same-origin page is already within the trust boundary. This is an authenticated local bridge, not remote identity verification or a security boundary against malicious local administrators.

## Tools

All schemas are defined in `src/tools.mjs` and returned by `tools/list`. The optional `tabId` selects an explicitly authorized tab. It may be omitted only when exactly one tab is connected.

| Tool | Purpose |
|---|---|
| `app_list_tabs` | Authorized tab names, revisions, lengths, permissions |
| `app_get_state` | Document metadata, selection, cursor, view, dialogs, renderer |
| `document_read` | Bounded text range, total length, revision, truncation flag |
| `document_set_text` | Replace document with supplied unsaved text |
| `document_new` | Empty Untitled document |
| `document_open_base64` | Decode and open supplied file bytes |
| `document_insert` | Insert at offset or replace active selection |
| `document_apply_edits` | Revision-required atomic batch using original offsets |
| `document_export` | Encoded base64 snapshot without saving |
| `document_save` | Existing authorized write handle or user-facing Save As |
| `edit_select` | Forward or reversed selection |
| `edit_find` | Literal search, direction/case/from/select options |
| `edit_replace` | Selected occurrence or atomic Replace All |
| `edit_undo`, `edit_redo` | Edit history |
| `edit_time_date` | F5 equivalent |
| `view_goto` | One-based logical line and column |
| `view_scroll` | Visual row / pixel coordinates |
| `view_set_options` | Wrap, status bar preference, font |
| `file_page_setup` | Read/set paper, orientation, margins, header/footer |
| `ui_command` | Named menu/window command |
| `ui_dialog` | Inspect/fill/click/close app dialogs |
| `app_get_metrics` | CPU render submission time, instances, document/worker state |
| `app_capture_viewport` | PNG text viewport reproduced from its render scene |

Read-only grants permit tools annotated `readOnlyHint: true`. Tools such as `edit_find`, `file_page_setup`, and `ui_dialog` can mutate selection or UI state and therefore require full control even when a particular invocation is informational. The annotations are descriptive; authorization is checked again by the server and browser.

## Revisions, coordinates, and safe editing

All text offsets and lengths are **UTF-16 code units**, not bytes or Unicode code points. Internal newlines are LF. Disk exports may use CRLF/LF/CR. Go To uses one-based logical line and column. A reversed selection preserves anchor and active cursor order.

Destructive new/open/set-text calls reject dirty documents unless `discardChanges: true` is supplied. `document_apply_edits` requires `expectedRevision`, validates all non-overlapping ranges before mutation, applies them in original-document coordinates, and creates one undo step. `document_insert` also accepts `expectedRevision`; use it when acting on previously read positions.

Example tool call:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "document_apply_edits",
    "arguments": {
      "expectedRevision": 12,
      "edits": [{"start": 0, "end": 5, "text": "Hello"}]
    }
  }
}
```

Replace revision and offsets with values read from the live document. For a multi-chunk read, verify that every returned revision remains the same; otherwise restart from a fresh snapshot.

Dialogs are addressed using IDs, names, or `data-action` values returned by `ui_dialog` inspection. Example: `ui_command {"command":"font"}`, inspect, set `font-size` to `12`, click `ok`. Password values are redacted and cannot be set through `ui_dialog`. This API does not control browser/OS file pickers, printer dialogs, clipboard permission prompts, or browser chrome.

`ui_command` returns immediately after initiating a command that may prompt. A Save As or Print dialog opening is not proof of saving/printing. `document_save` reports `requiresUserInteraction` when no already-writable handle exists. Export never marks the document saved. Captures show only the text viewport and are not a GPU readback or full OS screenshot.

## Resources and limits

Resources: `notepad://state`, `notepad://document`, `notepad://metrics`. Document resource reads return the first 65,536 code units; use `document_read` for later ranges. A `?tabId=...` query can select a tab.

Reads: at most 262,144 code units per call. Text inputs: at most 8,388,608 code units per field. Edit batch: at most 1,000 edits, also bounded by the transport's 16 MiB message limit. Base64 input: at most 12,582,912 characters. Encoded export: at most 8 MiB. Authorized tabs: 16; HTTP sessions: 64; queued operations per tab: 16; total jobs: 128.

Browser polls wait up to 25 seconds, job timeouts are 120 seconds, inactive tab cleanup is 120 seconds, and HTTP sessions expire after 30 minutes idle. A suspended/background tab may need to be re-enabled.

Cancellation removes a not-yet-delivered command. An already delivered edit may finish after cancellation or timeout; inspect revision/state before retrying a write. There is no false promise of transactional rollback across arbitrary UI operations.

## Example HTTP client

Start the server and explicitly enable a tab. Set the token in your shell, not in committed source:

```sh
NOTEPAD_TOKEN='paste-the-printed-token-here' node examples/mcp-client.mjs
```

PowerShell:

```powershell
$env:NOTEPAD_TOKEN = 'paste-the-printed-token-here'
node examples/mcp-client.mjs
```

The default example only lists tools/tabs and reads metadata plus a 256-code-unit preview. `--list-tools` does not require an authorized tab. An explicitly provided `--insert="text"` inserts at the current caret with a revision check. `NOTEPAD_URL` selects a different loopback endpoint.

For stdio, use `examples/mcp-config.json` as a template and replace the absolute path. Client configuration dialects differ; the template is the common `mcpServers` form, not a guarantee that every client accepts that exact outer structure.
