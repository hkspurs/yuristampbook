# PostgreSQL family RPC integration tests

Run from the repository root:

```sh
bash tests/cloud/run.sh
```

Needs Docker, Python 3, and the `postgres:17-alpine` image (first run downloads it).
The script creates one disposable, network-isolated PostgreSQL 17 container,
uses a 256 MB tmpfs data directory, applies the migration, runs synthetic tests,
and removes that container on exit. It does not publish a port or touch other
containers. The tmpfs size is a test infrastructure limit, not an app backup
limit. All database data is synthetic; no permanent credentials are required.

`bootstrap.sql` mocks `auth.uid()` using the PostgreSQL session JWT claim and
creates `anon` / `authenticated` roles. These are real PostgreSQL authorization,
transaction, row-lock and SQL tests, **not** a Supabase Auth email-delivery,
PostgREST, or production deployment test.

Coverage: shared balance and actor attribution, membership isolation, denied
anonymous RPC and direct writes, idempotency and changed/other-actor requests,
concurrent spending of the final stamp, strict numbers/time, reason snapshots,
settings revisions, spend/refund amounts, reversal restrictions, import
validation and intermediate balance replay, stale import revision and old
form generation, once-only/expired invites, simulated final-write failure
rollback, Unicode normalization and compact JavaScript-compatible intent.

The migration requires PostgreSQL ICU collation support (`zh-HK`) to match
JavaScript `toLocaleLowerCase('zh-HK')`, including contextual Greek sigma and
Unicode dotted I. Tests verify that behavior on PostgreSQL 17 Alpine.

The family JSON document and idempotency records are kept in the unexposed
`stamp_private` schema. RLS is enabled without client policies and direct
privileges are revoked. Only the five public, authenticated RPCs can mutate or
read family data. Each write holds the family row lock, and the server derives
actor identity from `auth.uid()`. This is a small-family ledger; returning and
validating the complete document is intentionally simple and will need a
paginated relational design if a family grows beyond practical document size.
