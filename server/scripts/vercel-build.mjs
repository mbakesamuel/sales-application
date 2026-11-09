import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

execSync("npx prisma generate", { cwd: root, stdio: "inherit" });

await mkdir(path.join(root, "api"), { recursive: true });
// Vercel "Other" / null framework expects a static output directory after build.
await mkdir(path.join(root, "public"), { recursive: true });

await build({
  absWorkingDir: root,
  entryPoints: [path.join(root, "src", "app.ts")],
  outfile: path.join(root, "api", "_app.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  logLevel: "info",
});

console.log("vercel-build: wrote api/_app.mjs");
