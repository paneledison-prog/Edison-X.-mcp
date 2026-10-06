# 03 - MCP Protocol Rules

Read before writing any tool.

## Use the official SDK
Build with `@modelcontextprotocol/sdk`. Support stdio and Streamable HTTP. Before coding, check the current MCP specification and SDK documentation for the version you install, since APIs evolve. Record the SDK version used in `docs/PLAN.md`.

## Tools
- One file per tool in `src/tools/`. Each exports a definition (name, description, input schema, annotations) and a handler.
- Descriptions are written for an AI agent: say what the tool does, when to call it, what it returns, and what it will not do. Keep them short and concrete.
- Parameter schemas include a `.describe()` for every field so the agent knows how to fill it in.
- Return both `content` (compact JSON text) and `structuredContent` (same data).
- Errors: return `isError: true` with a one-or-two-sentence message that says what failed and what to try. Never throw raw exceptions to the client.
- Set annotations honestly: `readOnlyHint`, `idempotentHint`, `openWorldHint`. Tools that write (collections, library) must not claim read-only.

## Stability
- Tool names are `snake_case` and permanent. Add fields to outputs only in a backward-compatible way (new optional fields). Never remove or rename a field without owner approval.
- Output limits: cap at 50 KB and say `truncated: true` when trimmed.
- Pagination uses opaque `cursor` / `next_cursor`.

## Tool descriptions must not be influenced by data
Tool descriptions and server instructions are static text authored by the builder. Never build them from database or source content.

## Images
- Default is URLs only. Return image content blocks only through `get_design` with `include_image: true` and only when the source's `canProxyImage` is true. Resize and size-cap them.

## Verification
- Run the MCP Inspector against both transports for every phase and record the result.
- Test with a real agent end to end in Phase 7.
