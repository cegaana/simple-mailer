import type { MailerTemplate, RenderedMessage } from "./types.js";

/**
 * Template rendering (§6, PRD-templates §4).
 *
 * v1 supports exactly two forms:
 *
 *   {{ variable }}
 *   {{ variable | default('Friend') }}
 *
 * with dotted paths (`{{ contact.profile.city }}`). Values interpolated into
 * HTML are entity-escaped; the text body is left as-is.
 *
 * Deferred (draft2 §6): `{{{ raw }}}`, `system.*`, signed unsubscribe URLs,
 * `{{ signature }}`.
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*default\(\s*(['"])(.*?)\2\s*\)\s*)?\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Walks a dotted path. Returns undefined rather than throwing on a missing hop. */
function lookup(data: Record<string, unknown>, path: string): unknown {
  let current: unknown = data;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Merge data arrives from CSV rows and CRM queries, so a value may be a number,
 * a boolean, null, or missing entirely — which is why `RecipientInput.metadata`
 * is `Record<string, unknown>` and not `any`. Narrow here, once.
 */
function stringify(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export interface RenderOptions {
  /** Throw on a placeholder with no value and no default. */
  strict?: boolean;
  /** Escape interpolated values. True for HTML bodies, false for text. */
  escape?: boolean;
}

export function renderString(
  template: string,
  data: Record<string, unknown>,
  options: RenderOptions = {},
): string {
  return template.replace(PLACEHOLDER, (_match, path: string, _q, fallback?: string) => {
    const resolved = stringify(lookup(data, path)) ?? fallback;

    if (resolved === undefined) {
      if (options.strict) {
        throw new Error(`Missing template variable "${path}" and no default was given`);
      }
      return "";
    }

    return options.escape ? escapeHtml(resolved) : resolved;
  });
}

/**
 * Renders a whole message.
 *
 * The subject comes from the campaign, not the template — see decision 20: the
 * campaign's subject is snapshotted at creation, so editing a template
 * mid-campaign cannot change the subject line of the unsent half.
 */
export function renderMessage(
  template: MailerTemplate,
  campaignSubject: string,
  data: Record<string, unknown>,
  options: RenderOptions = {},
): RenderedMessage {
  return {
    subject: renderString(campaignSubject, data, { ...options, escape: false }),
    html: renderString(template.bodyHtml, data, { ...options, escape: true }),
    text: renderString(template.bodyText, data, { ...options, escape: false }),
  };
}

export interface TemplateVariable {
  name: string;
  hasDefault: boolean;
  defaultValue?: string;
}

export function inspectVariables(...templates: string[]): TemplateVariable[] {
  const map = new Map<string, TemplateVariable>();
  for (const t of templates) {
    for (const match of t.matchAll(PLACEHOLDER)) {
      const name = match[1];
      if (!name) continue;
      const defaultValue = match[3];
      const hasDefault = defaultValue !== undefined;
      const existing = map.get(name);
      if (!existing) {
        map.set(name, { name, hasDefault, defaultValue });
      } else if (!hasDefault) {
        existing.hasDefault = false;
        existing.defaultValue = undefined;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every distinct placeholder name in a template — used by `template validate`. */
export function extractVariables(...templates: string[]): string[] {
  return inspectVariables(...templates).map((v) => v.name);
}
