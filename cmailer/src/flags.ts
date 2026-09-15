/**
 * The shape `node:util`'s `parseArgs` produces for every flag this CLI
 * accepts, hand-written rather than inferred so command handlers in
 * `commands/` can share one type without each importing `parseArgs`'s config.
 */
export interface CliFlags {
  /** Always present — parseArgs defaults it to "./data/mailer.db". */
  db: string;
  name?: string;
  subject?: string;
  template?: string;
  "template-name"?: string;
  slug?: string;
  html?: string;
  text?: string;
  csv?: string;
  data?: string;
  reason?: string;
  delay?: string;
  limit?: string;
  "scheduled-at"?: string;
  "dry-run": boolean;
  transport?: string;
  "out-dir"?: string;
  "google-user"?: string;
  "google-client-id"?: string;
  "google-client-secret"?: string;
  "google-refresh-token"?: string;
  stats?: boolean;
  config?: string;
  preset?: string;
  "ticket-type"?: string;
  "template-dir"?: string;
  strict: boolean;
  help: boolean;
  version: boolean;
}

/** Throws a consistent "Missing required option" error for any command. */
export function need(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`Missing required option --${flag}`);
  return value;
}
