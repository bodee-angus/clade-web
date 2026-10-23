# Clade Web migration

## Existing contract

Clade separates stable identity from display names. Templates govern ordered inherited Fields; Instances edit values, not schema. Link targets are constrained by template lineage. Functions use stable Field IDs. Desktop writes go through Rust/SQLite transactions; its JavaScript local-operation implementation was originally preview-only.

The first web milestone reuses that JavaScript model for a deliberately restricted local command surface. It does not claim to reproduce all Rust validation, intrinsic derivation, file management, or portable-vault integrity guarantees.

## Next implementation sequence

1. Add Supabase authentication and workspace ownership. Keep cloud mode explicitly separate from local mode; never upload local records automatically on login.
2. Design normalized PostgreSQL tables for workspaces, templates, fields, assignments, instances, values, and history. Scope every row by workspace. Foreign keys must reject cross-workspace references. Enable RLS before exposing APIs. Prove isolation using two users and an unauthenticated client.
3. Implement a server command boundary: validate the effective template contract, typed values, link targets, immutable identities, and revision inside one database transaction. Refuse stale writes. Do not trust client-side validation or expose privileged keys.
4. Add sign-in and an explicit local-to-cloud transfer flow with preview, backup, validation, and post-import counts. Preserve stable IDs. Do not treat a desktop SQLite file as a web JSON export.
5. Add private object storage with scoped signed URLs, ownership checks, upload limits, and attachment backups. Database backups alone do not back up object bytes.
6. Restore advanced capabilities incrementally against desktop tests. Add graph, analytics, intrinsic structures, and schema impact previews only when the corresponding authoritative writes exist.
7. Add manifest/icons and deliberate offline behavior. An installed icon is not a synchronization engine. Delay offline editing until conflict resolution is designed and tested.

## Hosting

Target independent static frontend hosting, initially Cloudflare Pages or Workers assets, with Supabase services. Confirm account and project settings before deployment. The current CSP intentionally blocks external connections; cloud integration must update it narrowly for the chosen project. Never embed secrets in built JavaScript.

## Safari QA acceptance

- Test 390px and 430px widths, portrait/landscape, touch targets, safe areas, and on-screen keyboard.
- Test native dialog focus, Escape, return focus, VoiceOver labels, and zoom.
- Test IndexedDB success, quota refusal, reload persistence, two-tab stale writes, and private-browsing limitations.
- Test long names, Unicode, HTML-like input, empty data, many fields, and link navigation.
- Test authentication redirects and token expiry on real Safari after cloud integration.

## Non-goals for milestone one

No silent migration of existing desktop data; no public demo records seeded into personal workspaces; no destructive UI; no public attachment buckets; no service role in the browser; no production-ready claims.
