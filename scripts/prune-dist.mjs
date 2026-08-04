import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const assetsDirectory = resolve("dist/assets");
const manifest = JSON.parse(readFileSync(resolve("dist/manifest.json"), "utf8"));
const workbenchHtml = readFileSync(resolve("dist/workbench.html"), "utf8");
const workbenchScript = readFileSync(resolve(assetsDirectory, "workbench.js"), "utf8");

for (const file of readdirSync(assetsDirectory)) {
  const isOldAppChunk = /^App-.*\.js$/.test(file) && !workbenchScript.includes(file);
  const isOldWorkbenchStyle =
    /^workbench-.*\.css$/.test(file) && !workbenchHtml.includes(file);
  const isOldSharedChunk =
    /^const-.*\.js$/.test(file) && !workbenchScript.includes(file);
  const isUnusedBackground = file === "background.js" && !manifest.background;

  if (isOldAppChunk || isOldWorkbenchStyle || isOldSharedChunk || isUnusedBackground) {
    unlinkSync(resolve(assetsDirectory, file));
  }
}
