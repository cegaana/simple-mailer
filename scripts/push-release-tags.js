#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const libPkg = JSON.parse(readFileSync(resolve(rootDir, "simple-mailer/package.json"), "utf-8"));
const cliPkg = JSON.parse(readFileSync(resolve(rootDir, "cmailer/package.json"), "utf-8"));

const libTag = `simple-mailer@${libPkg.version}`;
const cliTag = `cmailer@${cliPkg.version}`;

const existingTags = execSync("git tag -l", { encoding: "utf-8" })
  .split("\n")
  .map((t) => t.trim())
  .filter(Boolean);

const tagsToPush = [];

for (const tag of [libTag, cliTag]) {
  if (!existingTags.includes(tag)) {
    console.log(`🏷️  Creating tag: ${tag}`);
    execSync(`git tag ${tag}`, { stdio: "inherit", cwd: rootDir });
    tagsToPush.push(tag);
  } else {
    console.log(`ℹ️  Tag ${tag} already exists locally.`);
    tagsToPush.push(tag);
  }
}

if (tagsToPush.length > 0) {
  console.log(`🚀 Pushing tags to origin: ${tagsToPush.join(" ")}...`);
  try {
    execSync(`git push origin ${tagsToPush.join(" ")}`, { stdio: "inherit", cwd: rootDir });
    console.log(`✅ Tags pushed successfully! GitHub Actions will create the matching release(s).`);
  } catch (err) {
    console.error(`❌ Failed to push tags:`, err.message);
    process.exit(1);
  }
}
