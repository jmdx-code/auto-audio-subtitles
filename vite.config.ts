import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function copyFfmpegCore(): Plugin {
  return {
    name: "copy-ffmpeg-core",
    closeBundle() {
      const target = resolve("dist/vendor");
      mkdirSync(target, { recursive: true });
      for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
        copyFileSync(
          resolve(`node_modules/@ffmpeg/core/dist/esm/${file}`),
          resolve(target, file),
        );
      }
    },
  };
}

function copyReleaseDocuments(): Plugin {
  const files = [
    ["manifest.json", "manifest.json"],
    ["LICENSE", "LICENSE"],
    ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
    ["licenses/FFMPEG-WASM-MIT.txt", "licenses/FFMPEG-WASM-MIT.txt"],
    ["licenses/FFMPEG-GPL-2.0-OR-LATER.txt", "licenses/FFMPEG-GPL-2.0-OR-LATER.txt"],
    ["node_modules/@univerjs/preset-sheets-core/LICENSE", "licenses/UNIVER-APACHE-2.0.txt"],
    ["node_modules/@univerjs/presets/LICENSE", "licenses/UNIVER-PRESETS-APACHE-2.0.txt"],
    ["node_modules/@fontsource/noto-sans-myanmar/LICENSE", "licenses/NOTO-SANS-MYANMAR-OFL-1.1.txt"],
    ["node_modules/@webextkits/storage-local/LICENSE", "licenses/WEBEXTKITS-STORAGE-MIT.txt"],
    ["node_modules/edge-tts-universal/LICENSE", "licenses/EDGE-TTS-UNIVERSAL-AGPL-3.0.txt"],
    ["node_modules/lucide-react/LICENSE", "licenses/LUCIDE-ISC.txt"],
    ["node_modules/react/LICENSE", "licenses/REACT-MIT.txt"],
    ["node_modules/react-dom/LICENSE", "licenses/REACT-DOM-MIT.txt"],
  ] as const;

  return {
    name: "copy-release-documents",
    closeBundle() {
      for (const [source, destination] of files) {
        const target = resolve("dist", destination);
        mkdirSync(resolve(target, ".."), { recursive: true });
        copyFileSync(resolve(source), target);
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    copyFfmpegCore(),
    copyReleaseDocuments(),
  ],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        workbench: resolve(__dirname, "workbench.html"),
        launcher: resolve(__dirname, "launcher.html"),
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
