---
name: edison-x-builder
description: Build "Edison X", an MCP server that gives Claude and other AI agents searchable access to real website and app UI design inspiration (pins, screenshots, design references) through legally compliant source connectors. Use this skill whenever the user mentions Edison X, a UI-inspiration or design-reference MCP server, connecting Claude or other agents to Pinterest or design galleries, or asks to build, extend, debug, review, or audit any part of it, even if they never say "MCP". Contains mandatory rules, a master builder prompt, and a complete build guideline with acceptance criteria.
---

# Edison X Builder

Edison X is an MCP (Model Context Protocol) server. When a user asks Claude, or any other MCP-capable agent, to build a website or an app, the agent calls Edison X to find real UI inspiration: layouts, color palettes, components, and flows. It then designs from those references.

This skill tells a builder (an AI agent or a human) how to build Edison X completely and correctly.

## Read order (do not skip, do not reorder)

1. `Rules/00-hard-rules.md` - the non-negotiables. Read first, every session.
2. `Prompt.md` - the master prompt. It defines your role, your process, and how to report progress.
3. `Guidelines.md` - the full build specification: architecture, tool contracts, data model, phases, tests, final checklist.
4. The remaining files in `Rules/` - read each one before starting the phase it governs:
   - `01-sources-and-legal.md` - before writing any source adapter
   - `02-security.md` - before writing auth, storage, or any network code
   - `03-mcp-protocol.md` - before writing any tool
   - `04-code-quality.md` - before writing any code
   - `05-definition-of-done.md` - before declaring any phase or the whole project finished

## How to work

Build in the phases defined in `Guidelines.md` section 13. Finish a phase, prove it with its acceptance tests, report using the format in `Prompt.md`, then move on. Never start a later phase with an earlier one failing.

## Why the rules are strict

The most tempting shortcut in this project is scraping Pinterest or other galleries without permission. It makes a demo work in an afternoon and makes a product unshippable: it breaks without warning, violates the sources' terms, and exposes the owner legally. The rules exist so the finished server is something the owner can safely publish and that other agents can rely on.

## If something is unclear

Stop and ask the owner. Do not guess on legal, security, or source-access questions. Guessing on tool names, schemas, or phase order is also not allowed, because other agents will depend on those contracts.
