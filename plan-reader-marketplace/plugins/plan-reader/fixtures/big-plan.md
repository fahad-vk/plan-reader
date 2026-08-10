# Migrate the billing service to event-sourced ledgers

> A long, multi-section plan used as the development fixture for the viewer. It
> deliberately exercises headings at every level, fenced code, inline `code`,
> [links](https://example.com/docs), tables, and long prose so the TOC scroll-spy,
> read-time estimate, highlight-as-read, and code-aware narration all get a workout.

## Context

The current billing service mutates account balances in place. There is no audit
trail, reconciliation is manual, and a single bad write corrupts state permanently.
We are moving to an **event-sourced ledger**: balances become a projection over an
append-only stream of immutable entries. This is a large change touching the data
model, the API surface, and every downstream consumer.

This plan authorizes real changes to production billing code. Read it carefully.

## Goals and non-goals

### Goals
- Every balance change is an immutable, append-only ledger entry.
- Current balance is a projection, rebuildable from the stream at any time.
- Reconciliation becomes a pure function of the event log.

### Non-goals
- We are **not** changing the payment provider integration in this pass.
- We are **not** migrating historical data older than 18 months in v1.
- No UI changes beyond surfacing the new "transaction history" endpoint.

## Data model

The ledger table is append-only. No `UPDATE`, no `DELETE`. Ever.

| Column        | Type        | Notes                                    |
|---------------|-------------|------------------------------------------|
| `id`          | `uuid`      | Primary key, generated server-side       |
| `account_id`  | `uuid`      | Indexed; foreign key to `accounts`       |
| `amount`      | `bigint`    | Minor units (cents); signed              |
| `currency`    | `char(3)`   | ISO 4217                                 |
| `kind`        | `enum`      | `credit`, `debit`, `adjustment`          |
| `created_at`  | `timestamptz` | Server clock; never client-supplied    |
| `metadata`    | `jsonb`     | Free-form; provider refs, idempotency key|

### Projection

The balance projection is derived, cached in `account_balances`, and always
reconstructible:

```sql
SELECT account_id,
       SUM(amount) AS balance,
       MAX(created_at) AS last_entry_at
FROM ledger_entries
GROUP BY account_id;
```

## Steps

### Step 1 — Introduce the ledger table
Add the migration, but do not wire any writes yet. Deploy it dark so the schema
is present before code depends on it.

```js
// migrations/2026_08_add_ledger.js
exports.up = async (sql) => {
  await sql`
    CREATE TABLE ledger_entries (
      id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      account_id  uuid NOT NULL REFERENCES accounts(id),
      amount      bigint NOT NULL,
      currency    char(3) NOT NULL,
      kind        text NOT NULL CHECK (kind IN ('credit','debit','adjustment')),
      created_at  timestamptz NOT NULL DEFAULT now(),
      metadata    jsonb NOT NULL DEFAULT '{}'
    )`;
  await sql`CREATE INDEX ON ledger_entries (account_id, created_at)`;
};
```

### Step 2 — Dual-write behind a flag
Write to both the old balance column and the new ledger, gated by
`LEDGER_DUAL_WRITE`. Compare the two on every read; log divergence loudly.

```js
async function applyCharge(accountId, amountCents) {
  const entry = await ledger.append({ accountId, amount: -amountCents, kind: 'debit' });
  if (flags.LEDGER_DUAL_WRITE) {
    await legacy.decrementBalance(accountId, amountCents);
    await assertConverged(accountId); // alarms on drift
  }
  return entry;
}
```

### Step 3 — Backfill
Replay 18 months of legacy transactions into the ledger as historical entries.
This is idempotent — keyed on the legacy transaction id in `metadata`.

### Step 4 — Flip reads to the projection
Serve balances from `account_balances`. Keep dual-write on for one more week as
a safety net, then remove the legacy path.

### Step 5 — Remove the legacy column
Once divergence has been zero for seven days, drop `accounts.balance` and the
dual-write flag. This is the point of no return.

## Rollback strategy

| Phase            | Rollback action                                  | Risk   |
|------------------|--------------------------------------------------|--------|
| After Step 1     | Drop the table; no code depends on it            | None   |
| After Step 2     | Turn off `LEDGER_DUAL_WRITE`; legacy still canon | Low    |
| After Step 4     | Re-enable legacy reads via flag                  | Medium |
| After Step 5     | No rollback — restore from backup only           | High   |

## Verification

- Unit: projection sum equals legacy balance for 10k synthetic accounts.
- Property test: for any random sequence of credits/debits, projection is
  order-independent and equals the running total.
- Load: replay production traffic at 5× and confirm append latency stays under 10ms p99.
- Chaos: kill the writer mid-append and confirm no partial entries (append is atomic).

## Open questions

1. Do we need per-currency sub-ledgers, or is a single stream with a `currency`
   column sufficient for multi-currency accounts?
2. What is the retention policy for `metadata` containing provider PII?
3. Should reconciliation run continuously or nightly?

## Appendix — glossary

- **Projection**: a read model derived by folding over the event stream.
- **Idempotency key**: a client-supplied token ensuring a retried request applies once.
- **Drift**: any divergence between the legacy balance and the ledger projection.
