import type { Database } from 'better-sqlite3';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));

// The build copies schema/ into dist/schema/ so a compiled dist/ is
// self-contained; fall back to the package-root schema/ for dev/test runs
// against src/ directly (tsx/vitest), where no such copy exists.
const BUNDLED_SCHEMA_PATH = join(here, 'schema/mailer-schema.sql');
const SOURCE_SCHEMA_PATH = join(here, '../schema/mailer-schema.sql');
const SCHEMA_PATH = existsSync(BUNDLED_SCHEMA_PATH) ? BUNDLED_SCHEMA_PATH : SOURCE_SCHEMA_PATH;

export function initSchema(db: Database): void {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')

    const schema = readFileSync(SCHEMA_PATH, 'utf-8')

    db.exec(schema)
}