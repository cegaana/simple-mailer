import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { initSchema } from "./schema.js";

/**
 * Opens (creating if needed) a mailer database and initialises the schema.
 *
 * The directory is created here, not in `initSchema`: whoever chose the path
 * owns making it exist. `initSchema` takes a database it is handed.
 */
export function openMailerDatabase(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  initSchema(db);
  return db;
}
