import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
execFileSync(
  resolve(root, "node_modules/.bin/tsc"),
  ["-p", resolve(root, "tsconfig.build.json")],
  { stdio: "inherit" }
);
await cp(resolve(root, "static"), dist, { recursive: true });
