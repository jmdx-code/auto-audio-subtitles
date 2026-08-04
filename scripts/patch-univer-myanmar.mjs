import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const targets = [
  "node_modules/@univerjs/engine-render/lib/es/index.js",
  "node_modules/@univerjs/engine-render/lib/cjs/index.js",
];

const hasMyanmar = String.raw`function hasMyanmar(text) {
	return /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/u.test(text);
}
`;

const myanmarHandler = String.raw`function MyanmarHandler(index, charArray, viewModel, paragraphNode, sectionBreakConfig, paragraph) {
	const config = getFontCreateConfig(index, viewModel, paragraphNode, sectionBreakConfig, paragraph);
	const glyph = [];
	let step = 0;
	for (const newChar of charArray) {
		if (/^[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F\u200C\u200D]$/u.test(newChar)) {
			glyph.push(newChar);
			step += newChar.length;
		} else break;
	}
	return {
		step,
		glyphGroup: [createSkeletonWordGlyph(glyph.join(""), config)]
	};
}
`;

for (const relativePath of targets) {
  const filePath = resolve(relativePath);
  let source = await readFile(filePath, "utf8");
  if (source.includes("function MyanmarHandler(")) continue;

  const thaiDetector = "function hasThai(text) {";
  const thaiHandler = "function ThaiHandler(index, charArray, viewModel, paragraphNode, sectionBreakConfig, paragraph) {";
  const thaiBranch = "} else if (hasThai(char)) {";

  if (![thaiDetector, thaiHandler, thaiBranch].every((needle) => source.includes(needle))) {
    throw new Error(`Univer Myanmar patch no longer matches ${relativePath}`);
  }

  source = source.replace(thaiDetector, `${hasMyanmar}${thaiDetector}`);
  source = source.replace(thaiHandler, `${myanmarHandler}${thaiHandler}`);
  source = source.replace(
    thaiBranch,
    `} else if (hasMyanmar(char)) {\n\t\t\t\t\tconst { step, glyphGroup } = MyanmarHandler(i, src, viewModel, paragraphNode, sectionBreakConfig, paragraph);\n\t\t\t\t\tshapedGlyphs.push(...glyphGroup);\n\t\t\t\t\ti += step;\n\t\t\t\t\tsrc = src.substring(step);\n\t\t\t\t${thaiBranch}`,
  );
  await writeFile(filePath, source);
}
