# Testing

Every suite, its command, where it runs, and what only the author can check.
Toolchain: Node 22 (the version every workflow installs), npm 10.

## Suites and checks

| Suite or check | Command | Where it runs | Notes |
|---|---|---|---|
| Unit and contract tests (Vitest 3.2) | `npm test` | Locally; `quality.yml` on every push and pull request | Tests live beside their sources as `<name>.test.ts`. One pre existing skip in `electron/ipc/project/atomicSave.test.ts` |
| Type check | `npx tsc --noEmit` | Locally; `quality.yml` | Covers `src` and `electron` together |
| Lint (Biome 2.3) | `npm run lint` | Locally; `quality.yml` | |
| Format check (Biome) | `npm run format:check` | Locally; `quality.yml`, advisory | Twelve files failed before the zoom on typing work began; files that work touches are held clean |
| Locale consistency | `npm run i18n:check` | Locally; `quality.yml`, advisory | Every key in `en` must exist in every other locale |
| Packaged smoke checks | `npm run smoke:electron-main-cjs`, `npm run smoke:packaged-binaries` | Build workflows | Need a built app |

Install for testing exactly as CI does, with no native rebuilds:

```
npm ci --ignore-scripts
```

## Testing deviations

- The format check and the locale check are advisory in CI (they do not fail
  the workflow). Both predate this work. Files the zoom on typing work touches
  are held format clean regardless.
- There is no end to end suite spanning the Electron main process and the
  renderer. Each side is tested against doubles of the other; the cursor
  telemetry sidecar is the contract between them and has fixtures in
  `electron/ipc/cursor/cursorTelemetryTestFixtures.ts`.

## Author gates

Judgements only the author can make, on real recordings and real hardware.
The agent never claims one has passed.

| Gate | Phase | Status |
|---|---|---|
| A recording made with keyboard capture on, sidecar inspected, contains nothing from which typed content could be recovered | `ZE2` | outstanding |
| The keyboard capture control is discoverable, its copy honest, and it is reachable by keyboard | `ZE5` | outstanding |
| A suggested typing zoom lands where the author meant to look | `ZE3`, `ZE4` | outstanding |
| macOS: the native helper's keyboard tap works under the app's permission | `ZD1` | outstanding; probe in the session scratch directory |
