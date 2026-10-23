# Clade Web

A responsive web adaptation of Clade's structured knowledge workspace.

## Status: 0.1.0 foundation, not a hosted service

This first milestone runs without dependencies or accounts. It starts with a blank workspace and saves to IndexedDB in the current browser. **There is no sign-in, cloud synchronization, or shared database yet.** Clearing browser site data can erase the workspace. Export backups from Workspace.

Implemented:

- Responsive desktop and narrow-screen interface using system fonts and accessible native controls.
- Create Templates with parent inheritance.
- Create Text, Number, Checkbox, and constrained Link Fields.
- Create and edit Instances and their values, with inherited contracts.
- Template Bases, instance search, record details, history, JSON export.
- Atomic browser writes and revision checks to refuse stale saves from other tabs.
- Reused Clade model and calculation modules, with model and web-boundary tests.

Not implemented yet: Supabase authentication/storage, hosted deployment, desktop vault import, attachment handling, graph view, analytics editor, intrinsic editing, offline synchronization, JSON restore UI, and PWA manifest/service worker. This is not feature parity with desktop Clade. The browser command boundary is not a production server security boundary.

## Run

Requires Node.js 22 or later. No npm install is necessary.

```sh
npm test
npm run check
npm run build
npm start
```

Open http://localhost:4173. Build again after editing source. The generated `dist/` directory contains only public web assets. It can be deployed to a static host, independently of ChatGPT Sites.

## Supabase next milestone

A Supabase account is not needed for local development. Before cloud integration, create a project under your own account. Configure project URL and publishable key through deployment configuration. Never commit a database password, secret key, or service-role key.

The cloud phase must implement authenticated ownership, deny-by-default row-level security, transactional command validation, and revision-based conflict checks before any real records are uploaded. See [the migration plan](docs/WEB-MIGRATION.md).

## Privacy and public source

This repository contains code and fictional test fixtures only. Keep real workspaces, attachments, backups, and secrets outside Git. Public source code does not imply public application data.

## Source lineage

`src/model.js`, `src/calculations.js`, `tests/model.test.mjs`, and the Structural Rail SVG are retained from Clade desktop's `codex/windows-product-test` branch, inspected at source tree `d612c42d6ec917619d2043d16c5e93691c450237` (package version 0.9.1). The desktop repository and its history were not republished wholesale.

No open-source license has been selected yet. Public visibility alone does not grant a general reuse license.

## Verification limits

Node tests validate domain behavior and command restrictions. Safari/iPhone touch behavior, IndexedDB browser integration, and cloud authorization require separate browser/device and database tests. Do not treat unit tests as proof of those behaviors.
