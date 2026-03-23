import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const filesToCheck = [
  "db.js",
  "server.js",
  "static/app.js",
  "scripts/reset-data.mjs",
  "scripts/validate-system.mjs",
];

for (const file of filesToCheck) {
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const adminHtml = readFileSync("admin.html", "utf8");
const inlineScript = adminHtml.match(/<script>([\s\S]*)<\/script>\s*<\/body>/i)?.[1];
if (!inlineScript) {
  throw new Error("Inline admin script not found in admin.html");
}

new Function(inlineScript);
console.log("Syntax checks passed.");
