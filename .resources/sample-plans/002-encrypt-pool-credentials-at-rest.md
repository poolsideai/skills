# Plan 002: Encrypt Pool/provider API credentials at rest with Electron safeStorage

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 5b22088b..HEAD -- electron/config/service.ts electron/main.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `5b22088b`, 2026-06-10

## Why this matters

`AgentConfigService` persists every runtime API credential — including the Pool
access token and provider keys (Goose/Hermes/PI/Poolside Console) — as
**plaintext** inside the app's SQLite settings table, under the key literally
named `agent.config.plainSecrets`. Anyone who can read that database file
(Time Machine / cloud backups, a file-sync folder, another local user account,
or malware running as the user) recovers live, working API tokens and can
impersonate the user against the Pool API.

The repo already solved this exact problem elsewhere:
`electron/connectors/browser-playwright/browser-playwright-token-store.ts`
wraps tokens in Electron `safeStorage` (OS keychain–backed encryption) with a
graceful plaintext fallback when encryption is unavailable, and `main.ts`
already passes `electronMain.safeStorage` into `ConnectorService`. This plan
brings `AgentConfigService` up to the same standard: secrets are encrypted at
rest when `safeStorage` is available, with a transparent migration of any
already-stored plaintext secrets on first read/write.

This plan changes only *how* secret values are stored on disk. It must not
change the public behavior of any `storePoolApiKey` / `readPoolApiKey` /
`storeConsoleToken` / provider-secret call site.

## Current state

### The plaintext store (`electron/config/service.ts`)

Constant and constructor (lines 33–41, 51–54, 262–269):

```ts
const CONFIG_STATE_KEY = "agent.config.state";
const AUTH_AGENTS_KEY = "auth.agents";
const LEGACY_CONFIG_SECRET_KEY = "agent.config.secret";
const LEGACY_CONFIG_SECRETS_KEY = "agent.config.secrets";
const CONFIG_PLAINTEXT_SECRETS_KEY = "agent.config.plainSecrets";
const LOCAL_OLLAMA_API_KEY_SENTINEL = "ollama";

type PersistedSecretMap = Record<string, string>;

type AgentConfigServiceOptions = {
  db: AppDatabase;
  appDataPath: string;
};

export class AgentConfigService {
  readonly #db: AppDatabase;
  readonly #appDataPath: string;

  constructor(options: AgentConfigServiceOptions) {
    this.#db = options.db;
    this.#appDataPath = options.appDataPath;
  }
```

The single read/write chokepoints for the secret map (lines 654–661, 702–723):

```ts
private writeStoredApiKey(state: PersistedConfigState, apiKey: string): void {
  const profileKey = secretProfileKey(state);
  const secrets = this.readStoredSecretMap();
  secrets[profileKey] = apiKey;
  this.#db.setSetting(CONFIG_PLAINTEXT_SECRETS_KEY, secrets);
  this.#db.deleteSetting(LEGACY_CONFIG_SECRET_KEY);
  this.#db.deleteSetting(LEGACY_CONFIG_SECRETS_KEY);
}

private readStoredApiKey(state: PersistedConfigState | null): string | null {
  if (!state) {
    return null;
  }
  const profileKey = secretProfileKey(state);
  const secrets = this.readStoredSecretMap();
  const storedApiKey = secrets[profileKey] ?? null;
  if (state.runtimeKind === "pi") {
    return storedApiKey ?? secrets.pi ?? null;
  }
  return profileKey === "pool"
    ? normalizeStoredPoolApiKey(storedApiKey)
    : storedApiKey;
}

private readStoredSecretMap(): PersistedSecretMap {
  return (
    this.#db.getSetting<PersistedSecretMap>(CONFIG_PLAINTEXT_SECRETS_KEY) ??
    {}
  );
}
```

There are **five** `this.#db.setSetting(CONFIG_PLAINTEXT_SECRETS_KEY, secrets)`
write sites and **multiple** `readStoredSecretMap()` read sites in this file.
Find them all:

- writes: `grep -n 'setSetting(CONFIG_PLAINTEXT_SECRETS_KEY' electron/config/service.ts`
  (expect 5 matches: in `writeStoredApiKey`, `writeStoredProviderSecrets`,
  `clearPoolApiKey`, `storeConsoleToken`, `clearConsoleToken`)
- reads: `grep -n 'readStoredSecretMap()' electron/config/service.ts`
  (expect several: `writeStoredApiKey`, `writeStoredProviderSecrets`,
  `clearPoolApiKey`, `readStoredApiKey`, `readStoredSecretMap` def,
  `hasStoredSecret`, `storeConsoleToken`, `readConsoleToken`,
  `clearConsoleToken`, `listConfiguredPiProviderIds`, …)

The strategy below funnels ALL of them through two new private helpers so the
encryption logic lives in exactly one place.

### The exemplar to copy (`electron/connectors/browser-playwright/browser-playwright-token-store.ts`)

This is the pattern to match. Key parts:

```ts
export type SafeStorageLike = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

// save:
const state = this.#canUseSafeStorage()
  ? { storage: "safeStorage" as const,
      encryptedBase64: this.#safeStorage!.encryptString(token).toString("base64"),
      updatedAt }
  : { storage: "plaintext" as const, token, updatedAt };

// read:
if (state.storage === "plaintext") return state.token;
if (!this.#safeStorage) throw new Error("…secure storage is unavailable.");
return this.#safeStorage.decryptString(Buffer.from(state.encryptedBase64, "base64"));

#canUseSafeStorage(): boolean {
  try { return this.#safeStorage?.isEncryptionAvailable() === true; }
  catch { return false; }
}
```

### How `safeStorage` is wired in `main.ts`

`ConnectorService` already receives it (lines 745–755):

```ts
connectorService = new ConnectorService({
  db: appDatabase,
  // …
  safeStorage: electronMain.safeStorage,
});
```

`AgentConfigService` currently does NOT (lines 727–730):

```ts
configService = new AgentConfigService({
  db: appDatabase,
  appDataPath: app.getPath("userData"),
});
```

`electronMain` is the already-imported Electron main namespace in `main.ts`
(it exposes `electronMain.safeStorage`). Use the same reference the
`ConnectorService` wiring uses — do not add a new import.

### Conventions to follow

- Match the `SafeStorageLike` interface and the
  `storage: "safeStorage" | "plaintext"` discriminated-union persisted shape
  from the token-store exemplar exactly. Do not invent a different shape.
- Private fields use the `#name` syntax already used in this class
  (`this.#db`, `this.#appDataPath`).
- Keep `safeStorage` **optional** in the constructor options
  (`safeStorage?: SafeStorageLike | null`) so the existing unit test
  (`tests/electron/config-service.test.ts`, which constructs the service with
  only `{ db, appDataPath }`) keeps compiling and exercises the plaintext
  fallback path.

## Commands you will need

| Purpose            | Command                                                            | Expected on success          |
|--------------------|-------------------------------------------------------------------|------------------------------|
| Typecheck          | `pnpm check:electron`                                             | exit 0, no errors            |
| Run config tests   | `pnpm exec vitest --run tests/electron/config-service.test.ts`    | all pass                     |
| Run new test       | `pnpm exec vitest --run tests/electron/config-secret-encryption.test.ts` | all pass                     |
| Lint               | `pnpm lint`                                                       | exit 0                       |
| Fast verify        | `pnpm verify:quick`                                              | exit 0                       |

## Suggested executor toolkit

- Read the exemplar `electron/connectors/browser-playwright/browser-playwright-token-store.ts`
  and its test `tests/electron/browser-playwright-token-store.test.ts` in full
  before writing code — they are the template for both the implementation and
  the new test.

## Scope

**In scope** (the only files you should modify):
- `electron/config/service.ts`
- `electron/main.ts` (only the `new AgentConfigService({…})` call — add the
  `safeStorage` option)
- `tests/electron/config-secret-encryption.test.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `electron/connectors/**` and the browser-playwright token store — they
  already encrypt; this plan only mirrors their pattern.
- `electron/pool-auth/service.ts` — it stores only a credential `{id, name}`
  reference (no token); the token lives in `AgentConfigService`. Do not change
  pool-auth.
- The `LEGACY_CONFIG_SECRET_KEY` / `LEGACY_CONFIG_SECRETS_KEY` legacy keys —
  keep the existing `deleteSetting` calls for them exactly as-is; do not add
  new logic around the legacy keys.
- The persisted *key name* `CONFIG_PLAINTEXT_SECRETS_KEY` value
  (`"agent.config.plainSecrets"`) — keep the same DB key so existing installs'
  data is found and migrated. (You may rename the TS constant identifier if you
  wish, but the string value must not change.)
- Any change to the runtime profile / Hermes config path logic.

## Git workflow

- Branch: `advisor/002-encrypt-pool-credentials`
- Commit per logical unit (helper + migration; main wiring; test). Conventional
  commits style — e.g. `feat(config): encrypt stored API credentials with safeStorage`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the `SafeStorageLike` type and constructor option

In `electron/config/service.ts`:

1. Add the `SafeStorageLike` type (copy it verbatim from the token-store
   exemplar, or `import type { SafeStorageLike } from "../connectors/browser-playwright/browser-playwright-token-store"` — prefer the import to avoid a duplicate type, but ONLY if it does not violate a layer rule; if `pnpm lint` later flags the import as a layering violation, fall back to a local copy of the 5-line type and report that you did).
2. Extend `AgentConfigServiceOptions` with `safeStorage?: SafeStorageLike | null;`.
3. Add `readonly #safeStorage: SafeStorageLike | null;` and set it in the
   constructor: `this.#safeStorage = options.safeStorage ?? null;`.
4. Add a private `#canUseSafeStorage()` method copied from the exemplar.

**Verify**: `pnpm check:electron` → exit 0.

### Step 2: Change the persisted secret-map shape to support encryption

The current persisted value at `CONFIG_PLAINTEXT_SECRETS_KEY` is a flat
`Record<string, string>` (profileKey → plaintext secret). Introduce an
*envelope* persisted shape that can hold either plaintext (legacy / fallback)
or encrypted entries, while keeping the in-memory working type a decrypted
`Record<string, string>` so the rest of the class is unchanged.

Define:

```ts
type StoredSecretEnvelope =
  | { storage: "plaintext"; value: string }
  | { storage: "safeStorage"; encryptedBase64: string };

type PersistedSecretEnvelopeMap = Record<string, StoredSecretEnvelope>;
```

Then funnel ALL access through two new private helpers that replace the direct
`readStoredSecretMap()` / `setSetting(CONFIG_PLAINTEXT_SECRETS_KEY, …)` usage:

- `#readDecryptedSecretMap(): PersistedSecretMap` — reads the persisted value.
  It must accept BOTH the legacy flat `Record<string,string>` (decrypt = return
  as-is) AND the new envelope map (decrypt each entry). Detect legacy entries
  by value type: if a map value is a `string`, treat it as legacy plaintext; if
  it is an object with a `storage` field, decode per the envelope. For
  `storage: "safeStorage"`, decrypt with `this.#safeStorage.decryptString`; if
  `this.#safeStorage` is null at that point, throw the same "saved with secure
  storage but secure storage is unavailable" error the exemplar throws.
- `#writeDecryptedSecretMap(secrets: PersistedSecretMap): void` — encrypts each
  entry when `#canUseSafeStorage()` is true (envelope `storage: "safeStorage"`),
  otherwise writes `storage: "plaintext"` envelopes. Persists under the SAME
  `CONFIG_PLAINTEXT_SECRETS_KEY` string. Keep the existing
  `deleteSetting(LEGACY_CONFIG_SECRET_KEY)` /
  `deleteSetting(LEGACY_CONFIG_SECRETS_KEY)` calls that currently accompany the
  writes (move them into this helper so every write path still clears the
  legacy keys).

Then update `readStoredSecretMap()` to delegate to `#readDecryptedSecretMap()`,
and replace every `this.#db.setSetting(CONFIG_PLAINTEXT_SECRETS_KEY, secrets)`
call site (the 5 found in "Current state") with
`this.#writeDecryptedSecretMap(secrets)`. After this, no method other than the
two new helpers references `CONFIG_PLAINTEXT_SECRETS_KEY` for I/O.

**Verify**:
- `grep -n 'setSetting(CONFIG_PLAINTEXT_SECRETS_KEY' electron/config/service.ts`
  → matches ONLY inside `#writeDecryptedSecretMap`.
- `grep -n 'getSetting<PersistedSecretMap>\|getSetting<PersistedSecretEnvelopeMap>' electron/config/service.ts`
  → matches ONLY inside `#readDecryptedSecretMap`.
- `pnpm check:electron` → exit 0.

### Step 3: Migrate-on-write (lazy upgrade)

No separate migration pass is needed: because every read goes through
`#readDecryptedSecretMap` (which accepts legacy plaintext) and every write goes
through `#writeDecryptedSecretMap` (which re-encrypts the whole map when
safeStorage is available), the first time any secret is written the entire map
is upgraded to envelopes. This is the same lazy-upgrade approach the token
store uses. Do NOT write a one-shot migration that rewrites secrets on
construction — that would encrypt on app start even when the user never changes
a credential, and is out of scope.

**Verify**: covered by the test in Step 5 (legacy plaintext reads back, then a
write upgrades it to encrypted).

### Step 4: Wire `safeStorage` in `main.ts`

In `electron/main.ts`, change the `AgentConfigService` construction to pass the
same `safeStorage` reference `ConnectorService` already receives:

```ts
configService = new AgentConfigService({
  db: appDatabase,
  appDataPath: app.getPath("userData"),
  safeStorage: electronMain.safeStorage,
});
```

**Verify**: `pnpm check:electron` → exit 0; `grep -n "safeStorage: electronMain.safeStorage" electron/main.ts` → 2 matches (ConnectorService + AgentConfigService).

### Step 5: Write the test

Create `tests/electron/config-secret-encryption.test.ts`, modeled structurally
on `tests/electron/browser-playwright-token-store.test.ts` (the db stub) and
`tests/electron/config-service.test.ts` (constructing `AgentConfigService` with
a db stub + tmp appDataPath). Cover:

1. **Encrypts when available**: construct the service with a fake `safeStorage`
   (`isEncryptionAvailable: () => true`, `encryptString: v => Buffer.from("sealed:"+v)`,
   `decryptString: b => b.toString().replace(/^sealed:/,"")`). Call
   `storePoolApiKey("tok_live_example")`. Assert the raw persisted DB value for
   `"agent.config.plainSecrets"` does NOT contain the substring
   `"tok_live_example"` (i.e. `JSON.stringify([...db.settings.values()])` excludes it),
   and that `readPoolApiKey()` returns `"tok_live_example"`.
2. **Plaintext fallback**: construct with `safeStorage: null`. Store and read a
   pool key; assert round-trip works and the persisted envelope has
   `storage: "plaintext"`.
3. **Reads legacy flat plaintext**: pre-seed the db stub's
   `"agent.config.plainSecrets"` with a legacy flat map
   `{ pool: "legacy_tok_example" }` (a raw string value, not an envelope), then
   assert `readPoolApiKey()` returns `"legacy_tok_example"` with both a
   null and a real `safeStorage`.
4. **Lazy upgrade**: after the legacy-read in (3) with a working `safeStorage`,
   call `storeConsoleToken("c_example")` (any write), then assert the persisted
   `pool` entry is now an envelope with `storage: "safeStorage"` (the whole map
   was re-encrypted on write).
5. **Decrypt-unavailable error**: persist a `storage: "safeStorage"` envelope,
   then construct a fresh service with `safeStorage: null` and assert
   `readPoolApiKey()` throws an error mentioning secure storage is unavailable.

Do NOT use any real credential string anywhere — use the obvious fake literals
above.

**Verify**: `pnpm exec vitest --run tests/electron/config-secret-encryption.test.ts`
→ all 5 cases pass.

### Step 6: Full local gate

Run `pnpm verify:quick`.

**Verify**: exit 0 (lint + typecheck + unit tests all green, including the
pre-existing `config-service.test.ts`).

## Test plan

- New file `tests/electron/config-secret-encryption.test.ts` with the 5 cases
  in Step 5. Pattern: db stub from `browser-playwright-token-store.test.ts`;
  service construction from `config-service.test.ts`.
- The pre-existing `tests/electron/config-service.test.ts` must continue to
  pass unchanged — it constructs the service without `safeStorage`, exercising
  the plaintext-fallback path, which proves back-compat.
- Verification: `pnpm verify:quick` → all pass, including the 5 new cases.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm check:electron` exits 0
- [ ] `pnpm exec vitest --run tests/electron/config-secret-encryption.test.ts` passes with ≥5 cases
- [ ] `pnpm exec vitest --run tests/electron/config-service.test.ts` still passes (unchanged file)
- [ ] `pnpm lint` exits 0
- [ ] `grep -n 'setSetting(CONFIG_PLAINTEXT_SECRETS_KEY' electron/config/service.ts` matches only inside the new write helper
- [ ] `grep -n "safeStorage: electronMain.safeStorage" electron/main.ts` returns 2 matches
- [ ] The persisted-value string key remains `"agent.config.plainSecrets"` (grep the constant's value is unchanged)
- [ ] `git status` shows only the 3 in-scope files modified/created
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The "Current state" excerpts in `electron/config/service.ts` or
  `electron/main.ts` don't match the live code (drift since this plan was
  written).
- You cannot determine the correct `safeStorage` reference in `main.ts` (the
  `ConnectorService` wiring no longer passes `electronMain.safeStorage`) —
  report what the live wiring looks like instead of guessing an import.
- The `secretProfileKey` / `normalizeStoredPoolApiKey` / `pi` fallback logic in
  `readStoredApiKey` interacts with the envelope change in a way that breaks the
  existing `config-service.test.ts` and you cannot reconcile it within the
  in-scope files — report the conflict.
- A test's verification fails twice after a reasonable fix attempt.
- Importing `SafeStorageLike` from the connectors path triggers an ESLint layer
  violation (`electron/config` importing from `electron/connectors`) — fall
  back to a local copy of the type and note it in your report; do not disable
  the lint rule.

## Maintenance notes

- The encryption envelope is keyed to the OS keychain via Electron
  `safeStorage`. If the user's keychain changes (OS reinstall, moving the DB to
  a different machine), `decryptString` will fail — that is the intended
  security property (the secret is bound to the machine), and the
  decrypt-unavailable error path (test case 5) is the user-visible result: they
  re-authenticate. A reviewer should confirm the error surfaces as a
  re-auth prompt and not a crash.
- This plan deliberately does NOT add a startup migration pass — secrets upgrade
  lazily on next write. If product wants all existing installs encrypted
  immediately (not just on next credential change), that is a follow-up.
- Any *new* secret-bearing method added to `AgentConfigService` must go through
  `#readDecryptedSecretMap` / `#writeDecryptedSecretMap`, never
  `db.setSetting(CONFIG_PLAINTEXT_SECRETS_KEY, …)` directly. Reviewers should
  guard this in future PRs.
- Out of scope but worth a follow-up finding: any token already written in
  plaintext before this lands is recoverable from existing backups even after
  encryption — operators should treat already-stored Pool tokens as potentially
  exposed and rotate them. This plan does not (and cannot) rotate them.
