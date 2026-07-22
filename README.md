# OctoVault

OctoVault is a desktop app for keeping MCP credentials local while exporting MCP servers through a protected localhost proxy.

## Workflow

1. **Set internal secrets in the local vault**
   - Open **Vault** first.
   - Add credentials as `KEY` / `VALUE` pairs, for example `GITHUB_TOKEN`.
   - Values are encrypted locally and are never shown again.

2. **Define and export MCP servers locally**
   - Open **Servers**.
   - Add a stdio command or HTTP MCP endpoint.
   - Map env names to vault keys, for example `GITHUB_TOKEN=GITHUB_TOKEN`.
   - Click **Copy install JSON** for the client config.

3. **Use the local proxy without env params**
   - MCP clients connect to `http://127.0.0.1:<port>/mcp/<server>`.
   - Client JSON contains only the localhost URL and access key.
   - Credentials are injected only when OctoVault runs the actual MCP server.
   - Services using the proxy do not need the credentials.

## What it does

- Stores reusable vault secrets as local `KEY` / `VALUE` records.
- Keeps server config separate from credentials.
- Runs a protected localhost Express gateway for configured MCP servers.
- Supports stdio MCP commands and HTTP upstream MCP endpoints.
- Shows dashboard metrics for vault keys, servers, env mappings, requests, tool calls, estimated tokens, and errors.
- Copies MCP install JSON by click.

## Development

```bash
yarn install
yarn verify
```

Useful commands:

```bash
yarn start        # run Electron; builds missing dist assets automatically
yarn test         # node:test suite
yarn build:check  # TypeScript checks for main, renderer, and tests
yarn build        # production main + renderer assets
yarn bundle       # unpacked Electron app in release/
```

Platform installers:

```bash
yarn bundle:mac
yarn bundle:linux
yarn bundle:win
```

`electron-builder` writes artifacts to `release/`. Signing/notarization is not configured yet. `assets/brand.svg` is included as the source mark; export it to platform icon formats before a public release.

## App hints

- **Vault key** is the reusable secret name stored locally, such as `OPENAI_API_KEY`.
- **Env → vault key** maps the environment variable expected by an MCP server to a vault key. Example: `GITHUB_TOKEN=GITHUB_TOKEN`.
- **Working dir** is the optional folder where a stdio command starts. Use it for project files, relative config, or local `.env` files.
- **Enabled** controls whether the local proxy route is active.
- **Estimated tokens** are an approximation based on JSON payload size. They are for local visibility, not billing.

## Safety model

- Secret values are write-only in the UI.
- Electron `safeStorage` is used when available.
- Linux `basic_text` storage is blocked instead of silently storing weak secrets.
- The development fallback uses AES-256-GCM with `OCTOVAULT_PASSWORD`.
- The gateway binds to `127.0.0.1`, validates local Host/Origin headers, and requires `x-octovault-key`.
- Exported MCP JSON does not include env values or secret material.

See `.octocode/rfc/octovault/` for the RFC and implementation notes.
