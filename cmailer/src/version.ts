import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Reads the package version at runtime (works from src via tsx and from dist). */
export function readVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    return (JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
