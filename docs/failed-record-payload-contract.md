# Failed-Record Payload Contract

Canonical shape for failed-record payloads emitted by consumer transformer
services and persisted in `processingInfo.failedRecords` by the commons layer.

## Contract

All failed-record payloads MUST include:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | `string` | Yes | Human-readable title of the record |
| `standardIdentifiers` | `string[]` | Yes | Standard identifiers (ISBN, ISSN, SID, etc.) |
| `message` | `string` | Yes | Primary failure reason (single human-readable string) |

Optional:

| Field | Type | Description |
|-------|------|-------------|
| `messages` | `Message[]` | Structured error details (see below) |
| `record` | `unknown` | The record payload (MARC, JSON, or id). Include if useful for downstream reprocessing; omit if large or not actionable |

### `messages` array items

Each item in `messages` MAY be:

- A **string** (formatted error message) — simplest form, sufficient for most cases
- An **object** with:
  - `description` (`string`) — what went wrong
  - `state` (`string`) — severity, e.g. `"invalid"`, `"warning"`

### Auto-injected fields

The commons persistence layer (`mongoBlobs.ts`) injects `timestamp` automatically.
Transformers MUST NOT set `timestamp` themselves.

## Per-Transformer Status

### Quria (`melinda-record-import-transformer-quria`)

**Current payload:** `{failed: true, title, standardIdentifiers, message}`

- `title` — &#x2705; matches
- `standardIdentifiers` — &#x2705; matches
- `message` (string) — &#x2705; matches
- `record` — omitted — acceptable (converter-failure, no actionable record)

**Changes needed:** None. Quria is the reference implementation.

### Helmet (`melinda-record-import-transformer-helmet`)

**Current payload:** `{failed: true, title, standardIdentifiers, messages[], record}`

- `title` — &#x2705; matches
- `standardIdentifiers` — &#x2705; matches
- `messages[]` (string[]) — &#x26a0; uses `messages` (array) instead of `message` (string)
- `record` — included — acceptable (full MARC record for reprocessing)

**Changes needed:**

1. Add `message` field: join `messages` into a single string, e.g.
   `message: messages.join('; ')` — OR — rename `messages` to `message` if there's always one error.
2. Keep `messages` as optional structured detail if multiple errors are common.
3. Keep `record` (useful for downstream).

### Poistot (`melinda-record-import-transformer-poistot`)

**Current payload:** `{failed: true, record, messages[]}`

- `title` — &#x274c; **missing** — must add
- `standardIdentifiers` — &#x274c; **missing** — must add
- `messages[]` (`{description, state}[]`) — &#x26a0; uses `messages` (array of objects) instead of `message` (string)
- `record` — included — acceptable

**Changes needed:**

1. Add `title` — extract from the record (Poistot records have title fields)
2. Add `standardIdentifiers` — extract from the record
3. Add `message` — derive from `messages`, e.g. `message: messages[0].description` or `messages.map(m => m.description).join('; ')`
4. Keep `messages` as optional structured detail.

## Persistence Layer

`src/mongoBlobs.ts` pushes the `error` field into `processingInfo.failedRecords`
with an auto-injected `timestamp`:

```typescript
const failedRecord = typeof updatePayload.error === 'string'
  ? updatePayload.error
  : { ...updatePayload.error, timestamp: nowDate };
```

The blobHandler pass-through (`error: restForPayload`) ensures all fields from
the transformer payload are preserved.

## References

- Blob handler: `src/transformer/blobHandler.ts` (lines 95-125)
- Mongo persistence: `src/mongoBlobs.ts` (lines 363-390)
