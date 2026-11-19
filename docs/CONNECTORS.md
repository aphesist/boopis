# Connectors

The **connector collection** (`apps/shared/data/connectors.json`, schema `connectors.schema.json`) is the curated list of MCP servers boopis knows how to install, configure and trust. Any MCP server still works without being listed (COMPAT §6); listing adds a one-click install, the right forms and verified settings.

## What an entry promises
- **Pinned.** An exact package version or image digest, never `latest`. Bumps are reviewed changes to the file.
- **Verified.** Checked against the publisher's own sources on the date in `verified`, with those sources listed. Nothing in an entry is guessed: a value we couldn't confirm becomes a setup field the user fills in.
- **Variants.** One connector can run several ways, for example local, hosted, or a package with a key. The default variant is the one that keeps the most on the user's machine.
- **Honest network.** Each variant states its egress: `loopback`, a host list, or `any`. The sandbox and the policy use it, and the install form shows it.
- **Credentials through forms.** Every key is a `credential` form (FORMS.md). The key goes to the keychain and reaches the server through Hermes's secret source, never through config files or the transcript. OAuth variants use a `signin` form.

## How it's installed
1. The user picks a connector, from the connector catalog in the app or by asking the agent ("add Firecrawl").
2. A `connector` form shows the variant choice, what will run (command or URL), the egress, the licence and the pinned version.
3. Setup fields and credentials follow as `setup` and `credential` forms.
4. The server is written to Hermes's `mcp_servers` at the chosen scope (user, or the project once it's trusted) through Hermes's own config path. It appears in the details panel's Connectors list, with status.
5. Uninstall removes it the same way. Credentials are deleted only if the user agrees.

## Adding an entry
- Read the publisher's README, docs and releases.
- Pin the version.
- Fill `verified` with the date and the sources.
- Validate against the schema. CI validates the file.

## Entries
| Connector | Variants | Notes |
|---|---|---|
| Firecrawl | **local** (Firecrawl Local, default), hosted (OAuth, or a key), package with a key | Firecrawl Local (announced 2026-11-18) runs scrape, crawl and map as Rust primitives on the user's machine. The MCP server talks to it through `FIRECRAWL_API_URL`. Hermes's own web tools also use Firecrawl, and pointing them at the same local instance is a follow-up **[verify]** |
