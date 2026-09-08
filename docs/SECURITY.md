# Local security model

The server binds only to `127.0.0.1`, validates the exact expected Host and Origin, requires a bearer token on all MCP/bridge routes, and uses a separate random key for each paired browser tab. Read-only/full-control grants are enforced server-side. Tokens are compared using `timingSafeEqual` after length checks.

Source/static files are served from an explicit allowlist; there is no directory browsing, arbitrary file-read endpoint, shell execution, unrestricted path parameter, or file-write tool in the server. Native file access is delegated to the browser with its normal user permissions. An agent can edit/export document text after authorization, but cannot pass an operating-system path to have the companion read it.

The app has no analytics, CDN, remote font, account login, or runtime third-party dependency. The companion supplies a restrictive same-origin CSP, a standalone-script hash, no-referrer policy, and cross-origin isolation headers. Document and dialog text is escaped before HTML insertion. Tokens and document contents are not written into the bounded activity log; only tool names, status, and error messages are logged. Some errors may contain user-supplied strings (for example a search query), so treat logs as potentially sensitive.

The token is delivered in a fragment rather than an HTTP query and removed after capture. It is retained in sessionStorage for that tab. Protect stderr/client logs and token-bearing URLs. This design does not defend against untrusted code already executing in the same origin, browser extensions with page access, a malicious authorized agent, or local administrators.

Only pair agents you trust with the document. Read-only grants still disclose the document. A full-control agent can make destructive changes when it supplies the API's explicit discard flags. Revision checks protect against accidental stale edits, not malicious intent.

Do not bind the server publicly, reverse-proxy it onto the internet, or disable Host/Origin checks. The shipped implementation is intended for a local process and local browser. There is no OAuth discovery, remote user identity, multi-tenant isolation, or internet-deployment hardening.

Transport bodies and queues are bounded. Large files, copies, undo history, encoding, and wrapping can still consume substantial memory. These are application limits, not a claim of denial-of-service resistance against an already authorized local actor.

Disabling a tab rejects queued operations. An operation already executing in a worker or UI action may complete; inspect state before retrying. Browser native prompts, saves, and printing are not undone by cancelling an MCP request.

Security tests are in `tests/mcp.test.mjs`; they cover authentication, origin/host rejection, static route confinement, sessions, schema validation, pairing keys, and server-side read-only grants. These tests are not an independent security audit.
