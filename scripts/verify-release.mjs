import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const readJson = (file) => JSON.parse(readFileSync(resolve(file), "utf8"));
const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const source = readJson("manifest.json");
const built = readJson("dist/manifest.json");
assert.equal(source.version, pkg.version, "Manifest and package versions differ");
assert.equal(lock.version, pkg.version, "Lockfile version differs");
assert.equal(lock.packages[""].version, pkg.version, "Lockfile root version differs");
assert.deepEqual(built, source, "Built manifest differs from source");
const tag = process.argv[2];
if (tag !== undefined) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/, "Use a vX.Y.Z release tag");
  assert.equal(tag, `v${pkg.version}`, "Release tag and extension version differ");
}
const files = [source.action.default_popup, "workbench.html", ...Object.values(source.icons),
  ...source.content_scripts.flatMap((script) => script.js), "vendor/ffmpeg-core.js", "vendor/ffmpeg-core.wasm",
  "LICENSE", "THIRD_PARTY_NOTICES.md", "licenses/FFMPEG-GPL-2.0-OR-LATER.txt",
  "licenses/EDGE-TTS-UNIVERSAL-AGPL-3.0.txt"];
for (const file of files) assert(existsSync(resolve("dist", file)), `Missing packaged file: ${file}`);
for (const script of source.content_scripts.flatMap((entry) => entry.js)) {
  new vm.Script(readFileSync(resolve("dist", script), "utf8"));
}
console.log(`Verified extension v${pkg.version}${tag ? ` for ${tag}` : ""}`);
