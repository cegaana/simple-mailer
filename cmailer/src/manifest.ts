import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, isAbsolute } from "node:path";
import { inspectVariables } from "@cegaana/simple-mailer";
import type { CliFlags } from "./flags.js";
import { readCsvColumns } from "./csv.js";

export interface PresetConfig {
  name?: string;
  slug?: string;
  subject?: string;
  html?: string;
  text?: string;
  aliases?: string[];
  [key: string]: unknown;
}

export type ManifestConfig = Record<string, PresetConfig>;

/** Load and parse a JSON campaign manifest / tickets config file. */
export function loadManifest(configPath: string): ManifestConfig {
  const resolvedPath = resolve(process.cwd(), configPath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`Config file not found at: ${configPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, "utf8"));
  } catch (err) {
    throw new Error(
      `Failed to parse JSON in config file ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid config file ${configPath}: expected a JSON object mapping preset names to template configurations`,
    );
  }
  return parsed as ManifestConfig;
}

/** Look up a preset in the manifest by exact key or alias. */
export function selectPreset(
  manifest: ManifestConfig,
  targetPreset?: string,
  configPath = "config",
): { key: string; preset: PresetConfig } {
  const keys = Object.keys(manifest);
  if (keys.length === 0) {
    throw new Error(`Config file ${configPath} contains no preset definitions`);
  }

  if (targetPreset) {
    if (manifest[targetPreset]) {
      return { key: targetPreset, preset: manifest[targetPreset]! };
    }
    // Search aliases array
    for (const [key, preset] of Object.entries(manifest)) {
      if (Array.isArray(preset.aliases) && preset.aliases.includes(targetPreset)) {
        return { key, preset };
      }
    }
    throw new Error(
      `Preset "${targetPreset}" not found in ${configPath}. Available presets: ${keys.join(", ")}`,
    );
  }

  // If no preset specified, check if "default" exists or if there is exactly 1 key
  if (manifest["default"]) {
    return { key: "default", preset: manifest["default"]! };
  }
  if (keys.length === 1) {
    const onlyKey = keys[0]!;
    return { key: onlyKey, preset: manifest[onlyKey]! };
  }

  throw new Error(
    `Missing required option --preset (or --ticket-type). Available presets: ${keys.join(", ")}`,
  );
}

/** Resolve template file relative to template-dir, config dir, or cwd. */
export function resolveTemplateFilePath(
  file: string,
  configPath: string,
  templateDir?: string,
): string {
  if (isAbsolute(file)) return file;

  if (templateDir) {
    const candidate = resolve(process.cwd(), templateDir, file);
    if (existsSync(candidate)) return candidate;
  }

  const configDir = dirname(resolve(process.cwd(), configPath));
  const candidateConfigDir = resolve(configDir, file);
  if (existsSync(candidateConfigDir)) return candidateConfigDir;

  const candidateCwd = resolve(process.cwd(), file);
  if (existsSync(candidateCwd)) return candidateCwd;

  return templateDir ? resolve(process.cwd(), templateDir, file) : candidateConfigDir;
}

/** Populate CliFlags values from a JSON config file. */
export function applyManifestConfig(values: CliFlags): void {
  if (!values.config) return;

  const manifest = loadManifest(values.config);
  const target = values.preset ?? values["ticket-type"];
  const { key, preset } = selectPreset(manifest, target, values.config);

  values.template = values.template ?? preset.slug ?? key;
  values["template-name"] = values["template-name"] ?? preset.name ?? values.name ?? key;
  values.subject = values.subject ?? preset.subject;
  values.name = values.name ?? preset.name ?? `${key} Campaign`;

  if (preset.html) {
    const resolvedHtml = resolveTemplateFilePath(preset.html, values.config, values["template-dir"]);
    if (!existsSync(resolvedHtml)) {
      throw new Error(`HTML template file not found: ${resolvedHtml}`);
    }
    values.html = resolvedHtml;
  }

  if (preset.text) {
    const resolvedText = resolveTemplateFilePath(preset.text, values.config, values["template-dir"]);
    if (!existsSync(resolvedText)) {
      throw new Error(`Text template file not found: ${resolvedText}`);
    }
    values.text = resolvedText;
  }
}

/** Preflight check: validates that all required placeholders in the template exist in CSV headers. */
export function checkTemplateVariables(
  subject: string,
  html: string,
  text: string,
  csvPath: string,
  strict = false,
): { missing: string[]; available: string[]; required: string[] } {
  const inspected = inspectVariables(subject, html, text);
  const required = inspected.filter((v) => !v.hasDefault).map((v) => v.name);
  const columns = readCsvColumns(csvPath);
  const colSet = new Set(columns.map((c) => c.toLowerCase()));
  colSet.add("email");
  colSet.add("name");

  const missing = required.filter((v) => {
    const root = v.split(".")[0]!.toLowerCase();
    return !colSet.has(root) && !colSet.has(v.toLowerCase());
  });

  if (missing.length > 0) {
    const msg = `Template requires variable(s) not found in CSV (${csvPath}): ${missing.join(", ")}\nAvailable CSV columns: ${columns.join(", ")}`;
    if (strict) {
      throw new Error(`Preflight check failed: ${msg}`);
    } else {
      console.warn(`⚠️  Preflight warning: ${msg}\n`);
    }
  }

  return { missing, available: columns, required };
}
