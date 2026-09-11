# TitleOS web application

See the [repository README](../README.md) for local setup, scope, and the walkthrough, and the [system blueprint](../docs/system-blueprint.md) for architecture and planned integrations.

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run typecheck
npm test
npm run build
```

The UI is in `app/` and `components/title/`. Domain fixtures, state, and automation/report calculations are in `lib/title/`. Browser metadata is localStorage-only and file blobs are IndexedDB-only. Optional starter backend helpers are not connected to the application.
