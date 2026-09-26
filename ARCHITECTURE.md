# Transport History architecture

Transport History remains a monorepo and is being migrated incrementally from a
single Node.js API to small Go services. The browser keeps one stable `/api`
contract throughout the migration.

## Runtime services

- `web` — React/Vite application served by nginx.
- `api` — the public Go API and only backend entry point for the browser.
- `legacy-api` — the existing Node.js implementation on the private Compose
  network. The Go API proxies endpoints that have not moved yet.
- `db` — PostgreSQL/PostGIS, currently also responsible for schema migrations
  started by the legacy service.
- `worker` — a prepared Go command for durable background jobs. It is not run
  until the first real asynchronous workload is extracted.

The current request flow is:

```text
browser -> nginx -> Go API -> PostgreSQL
                         \-> legacy Node API -> PostgreSQL
```

## Functional boundaries

Code should be organised by domain even while it shares a deployable binary:

1. History display — viewport queries, timeline, system summaries and export.
2. Editor — drafts, object edits and commits.
3. Moderation — review queues, areas and publication decisions.
4. Administration — users, roles and operational controls.

Authentication and user/role administration are already native Go endpoints.
History, editor, moderation and snapshot endpoints are temporarily served by
the internal legacy API.

## Migration rules

- Keep API paths and response shapes compatible with the frontend.
- Move one domain slice at a time; delete its legacy route only after parity
  tests and a production smoke test pass.
- Do not split repositories or databases merely to mirror code boundaries.
- Add another deployable service only when it has an independent scaling,
  isolation or lifecycle requirement.
- Prefer viewport- and time-bounded PostGIS queries. Large exports and spatial
  projection rebuilds should become durable worker jobs rather than block HTTP.
- Keep schema migrations explicit and single-owner. Moving migration ownership
  from Node is a separate step from moving request handlers.

## Next extraction order

1. Define contract tests for `/api/map`, `/api/state`, `/api/catalog` and export.
2. Move read-only history queries to Go and add cache headers/ETags.
3. Move editor commits with transaction and geometry validation tests.
4. Move moderation, then snapshots and background projection jobs.
5. Remove `legacy-api` after its last route and migration responsibility move.
