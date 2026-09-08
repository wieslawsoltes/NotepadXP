# Compatibility contract

## Target

The target is the English Windows XP SP3-era desktop Notepad using the blue Luna visual style at ordinary desktop scaling. The application provides that menu structure, caption styling, classic control colors/borders, editing commands, and XP-shaped dialogs. It does not execute Win32 code.

“100% identical” is not an audited property of this release. There was no automated pixel comparison with a running XP installation. The desktop/mobile screenshots from the original delivery show this implementation, not Windows XP.

## Implemented scope and deliberate differences

| Area | Implemented | Boundary / deliberate difference |
|---|---|---|
| Window | Luna caption, original note icon, minimize/restore, maximize/restore-down, drag, resize, close/reopen | Browser page rather than a Win32 top-level window; standard system Move/Size menu commands are not reproduced |
| Menus | File, Edit, Format, View, Help; mnemonics, keyboard/menu navigation, context edit menu | AI Agent Control is an additional Help item; context-menu Unicode insertion/reading-order extensions are not reproduced |
| Text editing | Real text model, selections, typing, delete, navigation, clipboard, undo/redo, touch input proxy | Multi-level undo/redo is an extension; bounded textarea provides input/accessibility context, not a complete native screen-reader document view |
| Find/Replace | Literal case-sensitive/insensitive search; up/down; Find Next; selection replacement; atomic Replace All | Modern Unicode case handling can differ from old regional Win32 mappings; no regular-expression UI |
| Go To / status | One-based logical line/column display; Go To dialog; classic Word Wrap restrictions | Columns count UTF-16 code units, including surrogate pairs; agent Go To deliberately works with wrap enabled |
| Font | Family/style/point-size controls; script sample; whole-document display font | Installed system fonts determine rasterization; family list is curated, not OS font enumeration; script field changes sample only; kerning/bidi caret geometry is not a full shaping engine |
| File dialogs | XP-styled browser document list, folders, names, type filter, encoding, overwrite confirmation, native Browse | “My Documents” / “Desktop” here are site storage, not real OS special folders; actual device access invokes browser/OS pickers |
| Encoding | ANSI / UTF-8 / UTF-16 LE / UTF-16 BE; BOMs; regional 1250–1258; EOL retention | Safer BOM-less detection instead of recreating historical corruption heuristics; ANSI loss is blocked instead of lossy confirmation; code page selection is in Agent Control |
| Save | Native writable handles when authorized; download fallback; explicit saved copies in site storage | Browser downloads cannot prove that the OS completed a save; native file permission/cancellation is never bypassed; verify the resulting file |
| Print | Paginated body, selected font, paper/orientation/margins, per-page headers/footers, browser print invocation | Browser/OS printer UI, not XP's printer dialog; fixed four paper sizes; automatic paper source only; 2,000-page preparation bound |
| Logging | `.LOG` first-line behavior and F5 timestamp insertion | Time/date formatting follows host locale, not an emulated XP locale database |
| Help/About | Real built-in help, app/version/render status, tool documentation | Original Windows Help content, product IDs, installed-owner fields, and branding artwork are not copied |
| Touch | Tap, long-press word selection, handles, pan, responsive dialogs | Touch target enlargement and full-window mobile layout are intentional departures from fixed XP desktop pixel dimensions |
| WebGPU | WGSL instanced run atlas; cached rasterized text; selection and caret composition | Canvas performs glyph rasterization on cache misses; text manipulation is on CPU/worker; actual WebGPU runtime remains unverified in packaged QA |
| MCP | 24 tools, resources, stdio and JSON Streamable HTTP, tab authorization | Requires included Node companion for external clients; no browser TCP server, shell, unrestricted file API, OAuth discovery, or remote-hosted endpoint |

## Unicode, input, and accessibility

File encoding preserves multilingual Unicode text and surrogate pairs. Keyboard caret stepping uses grapheme segmentation where available, and there is a native composition input path. Canvas shapes visible text runs using the browser's text APIs. However, width checkpoints and hit testing do not implement a complete Unicode bidirectional layout algorithm or full script-aware caret geometry. Arabic/Hebrew mixed-direction editing, Indic shaping, complex emoji sequences, dead keys, and physical mobile IMEs need additional device-specific validation.

Menus and dialogs have semantic controls, focus management, labels, keyboard navigation, and live feedback. A virtualized canvas editor with a bounded hidden textarea does not have full native Notepad screen-reader parity. Full-document accessibility traversal is not claimed.

## Persistence and permissions

Settings are saved in localStorage where available. Explicit saved copies are stored in IndexedDB. Unsaved documents are **not** auto-saved or crash-recovered. Private mode, storage eviction, denied IndexedDB, opaque origins, and browser data clearing can remove storage; memory fallback lasts only for the current page.

A download is a save request, not a verified filesystem write. After download-based saving, the app marks the exported snapshot clean and retains a browser copy where available. Check the download completed before closing the only copy. An edit that occurs during an asynchronous save remains dirty because the saved root is tracked separately.

Browser-reserved shortcuts, clipboard permissions, print controls, and file-picking permissions remain under browser/OS control. A native picker cannot be populated or confirmed through `ui_dialog`. MCP `document_save` only directly writes a handle whose write permission was already granted; otherwise it opens Save As for the user.

## Large files

Unwrapped ASCII/monospace text is the optimized path. Initial input decoding, tree creation, wrap rebuilding, global search, replace-all, and encoding are not constant-time operations. A worker mirror and structured cloning increase memory usage. Very large files can exceed the browser/device memory limit; opening files above 512 MiB requires an additional warning confirmation, not a guarantee they will fit.

MCP bounded reads are at most 262,144 UTF-16 code units. Base64 export is limited to 8 MiB. Large documents should be read in revision-aware chunks. Network messages are capped at 16 MiB. Printing prepares at most 2,000 pages.

## Browser validation status

The original integration report is from Chromium in a managed, opaque-origin injected-content environment, with Canvas fallback and no browser worker. It checks actual app behavior and emulated touch layout, but does not demonstrate WebGPU availability, browser worker startup, native disk writes, printer output, mobile keyboard behavior, or cross-browser compatibility. Runtime state always reports the actual renderer and fallback reason; no “WebGPU” label is substituted when Canvas is in use.
