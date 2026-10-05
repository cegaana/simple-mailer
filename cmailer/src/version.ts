import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

/** Reads the package version and build stamp at runtime. */
export function readVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    const ver = pkg.version || "2.0.0";

    let gitHash = "";
    try {
      gitHash = execSync("git rev-parse --short HEAD 2>/dev/null", {
        cwd: fileURLToPath(new URL("..", import.meta.url))
      }).toString().trim();
    } catch {}

    const hashStr = gitHash && gitHash !== "unknown" ? `+${gitHash}` : "";

    let buildTime = "";
    try {
      const stats = statSync(fileURLToPath(import.meta.url));
      buildTime = stats.mtime.toISOString().slice(0, 16).replace("T", " ") + "Z";
    } catch {}

    const timeStr = buildTime ? ` (built ${buildTime})` : "";
    return `${ver}${hashStr}${timeStr}`;
  } catch {
    return "2.0.0";
  }
}
