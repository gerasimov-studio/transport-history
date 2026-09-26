# Transport History architecture

Transport History is a monorepo with a modular Go backend. The browser uses one
stable `/api` contract; domain boundaries are internal packages rather than
network boundaries.

## Runtime services

- `web` — React/Vite application served by nginx.
- `api` — the public Go API and only backend entry point for the browser.
- `db` — PostgreSQL/PostGIS. Schema setup is owned by the Go API.
- `worker` — a prepared Go command for durable background jobs. It is not run
  until the first real asynchronous workload is extracted.

The current request flow is:

```text
browser -> nginx -> Go API -> PostgreSQL/PostGIS
```

## Functional boundaries

Code should be organised by domain even while it shares a deployable binary:

1. History display — viewport queries, timeline, system summaries and export.
2. Editor — drafts, object edits and commits.
3. Moderation — review queues, areas and publication decisions.
4. Administration — users, roles and operational controls.

Authentication, history, editor, moderation, administration, snapshots and
export are all implemented by the Go API.

## Migration rules

- Keep API paths and response shapes compatible with the frontend.
- Do not split repositories or databases merely to mirror code boundaries.
- Add another deployable service only when it has an independent scaling,
  isolation or lifecycle requirement.
- Prefer viewport- and time-bounded PostGIS queries. Large exports and spatial
  projection rebuilds should become durable worker jobs rather than block HTTP.
- Keep schema migrations explicit and owned by the Go backend.

## Next steps

1. Expand contract and integration tests around map, editor and moderation flows.
2. Add cache headers/ETags to read-only history responses.
3. Move large exports and projection rebuilds to durable worker jobs.
4. Extract a module into a separate service only when production scaling,
   isolation or lifecycle data justifies the operational cost.
