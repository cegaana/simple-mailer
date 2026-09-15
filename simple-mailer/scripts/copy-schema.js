#!/usr/bin/env node
// Copies schema/*.sql into dist/schema/ so the compiled package is a
// self-contained artifact and doesn't rely on a sibling source folder
// surviving alongside dist/ at runtime.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(root, "schema");
const dest = join(root, "dist", "schema");

mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
