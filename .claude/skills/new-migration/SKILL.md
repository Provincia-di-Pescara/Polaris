---
name: new-migration
description: Scaffold a new Postgres migration pair (NNNNNN_nome.up.sql / .down.sql) with the numbering and structure this repo uses. Use when adding a new DB migration to db/migrations/.
---

# new-migration

Scaffolds a new migration pair in `db/migrations/`, matching this repo's conventions (see `docs/claude/schema-db.md` for the full gotcha list).

## Steps

1. Find the highest existing migration number:
   ```
   ls db/migrations | sort | tail -5
   ```
2. Next number = highest + 1, zero-padded to 6 digits (e.g. `000025`).
3. Ask the user (or infer from context) a short snake_case name for the migration, e.g. `dae_impianti`.
4. Create both files:
   - `db/migrations/NNNNNN_nome.up.sql`
   - `db/migrations/NNNNNN_nome.down.sql`
5. The `.down.sql` must fully reverse the `.up.sql` (drop what was created, in reverse order).

## Reminders specific to this repo

- Never edit an already-committed migration file — this is enforced by a PreToolUse hook (`.claude/hooks/guard-migration-edit.cjs`). Always add a new migration instead.
- Common gotchas documented in `docs/claude/schema-db.md`: `num_nonnulls` for mutually-exclusive-column checks, `EXCLUDE USING gist` for overlap constraints, `GENERATED` columns.
- Any parameter value (thresholds, defaults) belongs in `allegato_parametrico` (versioned table), never hardcoded in migration DDL as a magic number — see CLAUDE.md "Vincoli progettuali non negoziabili" and `docs/claude/parametrico-normativo.md`.
- Test locally against Postgres 18 before committing — see `docs/claude/schema-db.md` for the local test commands.
