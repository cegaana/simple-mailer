import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { initSchema } from '../src/schema.js';

const EXPECTED_TABLES = [
  '_mailer_campaigns',
  '_mailer_logs',
  '_mailer_queue',
  '_mailer_signatures',
  '_mailer_suppression',
  '_mailer_templates',
].sort();

function tableNames(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

describe('initSchema', () => {
  it('creates all six _mailer_ tables', () => {
    const db = new Database(':memory:');   // arrange
    initSchema(db);                        // act
    expect(tableNames(db)).toEqual(EXPECTED_TABLES);  // assert
  });

  it('is idempotent — running twice changes nothing', () => {
    const db = new Database(':memory:');
    initSchema(db);
    const before = tableNames(db);

    initSchema(db);

    expect(tableNames(db)).toEqual(before);
  });

  it('enables foreign key enforcement', () => {
    const db = new Database(':memory:');
    initSchema(db);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});