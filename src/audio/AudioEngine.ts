import { FFmpeg } from "@ffmpeg/ffmpeg";

import {
  AUDIO_BITRATE,
  AUDIO_SAMPLE_RATE,
  SILENCE_THRESHOLD,
  START_PADDING_SECONDS,
} from "@/const";

export class AudioEngine {
  private ffmpeg: FFmpeg;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly onLog?: (message: string) => void) {
    this.ffmpeg = this.createFfmpeg();
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      const ffmpeg = this.ffmpeg;
      this.loadPromise = ffmpeg
        .load({
          coreURL: chrome.runtime.getURL("vendor/ffmpeg-core.js"),
          wasmURL: chrome.runtime.getURL("vendor/ffmpeg-core.wasm"),
        })
        .then(() => undefined)
        .catch((error) => {
          if (this.ffmpeg === ffmpeg) this.loadPromise = null;
          throw error;
        });
    }
    await this.loadPromise;
  }

  async trimToWav(
    audio: Uint8Array,
    uniqueId: string,
    endPaddingSeconds: number,
  ): Promise<Uint8Array> {
    return this.runWithMemoryRecovery("静音裁剪", async (ffmpeg) => {
      const input = `${uniqueId}-raw.mp3`;
      const output = `${uniqueId}-trimmed.wav`;
      const startMs = Math.round(START_PADDING_SECONDS * 1000);
      const endMs = Math.round(endPaddingSeconds * 1000);
      const filter = [
        `silenceremove=start_periods=1:start_duration=0:start_threshold=${SILENCE_THRESHOLD}`,
        "areverse",
        `silenceremove=start_periods=1:start_duration=0:start_threshold=${SILENCE_THRESHOLD}`,
        `adelay=${endMs}:all=1`,
        "areverse",
        `adelay=${startMs}:all=1`,
      ].join(",");

      try {
        // writeFile transfers its buffer, so each recovery attempt gets a copy.
        await ffmpeg.writeFile(input, audio.slice());
        const code = await ffmpeg.exec([
          "-hide_banner",
          "-loglevel",
          "error",
          "-i",
          input,
          "-af",
          filter,
          "-ar",
          String(AUDIO_SAMPLE_RATE),
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          output,
        ]);
        if (code !== 0) throw new Error(`静音裁剪失败（FFmpeg ${code}）。`);
        const result = await ffmpeg.readFile(output);
        if (typeof result === "string") throw new Error("FFmpeg 返回了错误的音频格式。");
        return new Uint8Array(result);
      } finally {
        await this.safeDelete(ffmpeg, input);
        await this.safeDelete(ffmpeg, output);
      }
    });
  }

  async encodeMp3(
    wavSources: ReadonlyArray<() => Promise<Uint8Array>>,
    uniqueId: string,
  ): Promise<Uint8Array> {
    return this.runWithMemoryRecovery("MP3 合并", async (ffmpeg) => {
      const inputNames = wavSources.map(
        (_source, index) => `${uniqueId}-input-${String(index).padStart(3, "0")}.wav`,
      );
      const listName = `${uniqueId}-concat.txt`;
      const outputName = `${uniqueId}-output.mp3`;

      try {
        for (let index = 0; index < wavSources.length; index += 1) {
          // Load and transfer one WAV at a time instead of retaining the whole
          // group in both JavaScript and the WASM in-memory file system.
          await ffmpeg.writeFile(inputNames[index], await wavSources[index]());
        }
        await ffmpeg.writeFile(
          listName,
          new TextEncoder().encode(
            inputNames.map((name) => `file '${name}'`).join("\n"),
          ),
        );
        const code = await ffmpeg.exec([
          "-hide_banner",
          "-loglevel",
          "error",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listName,
          "-c:a",
          "libmp3lame",
          "-b:a",
          AUDIO_BITRATE,
          outputName,
        ]);
        if (code !== 0) throw new Error(`MP3 合并失败（FFmpeg ${code}）。`);
        const result = await ffmpeg.readFile(outputName);
        if (typeof result === "string") throw new Error("FFmpeg 返回了错误的 MP3 格式。");
        return new Uint8Array(result);
      } finally {
        await Promise.all([
          ...inputNames.map((name) => this.safeDelete(ffmpeg, name)),
          this.safeDelete(ffmpeg, listName),
          this.safeDelete(ffmpeg, outputName),
        ]);
      }
    });
  }

  recycle(): void {
    const previous = this.ffmpeg;
    this.ffmpeg = this.createFfmpeg();
    this.loadPromise = null;
    try {
      previous.terminate();
    } catch {
      // A trapped WASM worker can already be unavailable.
    }
  }

  terminate(): void {
    try {
      this.ffmpeg.terminate();
    } catch {
      // The worker may already have terminated after a fatal WASM error.
    }
    this.loadPromise = null;
  }

  private createFfmpeg(): FFmpeg {
    const ffmpeg = new FFmpeg();
    ffmpeg.on("log", ({ message }) => this.onLog?.(message));
    return ffmpeg;
  }

  private async runWithMemoryRecovery<T>(
    operationName: string,
    operation: (ffmpeg: FFmpeg) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await this.ensureLoaded();
        return await operation(this.ffmpeg);
      } catch (error) {
        if (!isWasmMemoryFailure(error)) throw error;
        this.recycle();
        if (attempt === 1) {
          this.onLog?.(`${operationName}遇到浏览器音频内存异常，已重置引擎并自动重试。`);
          continue;
        }
        throw new Error(
          `${operationName}因浏览器音频内存异常失败；引擎已重置，请拆分过长文案后重试失败项。`,
          { cause: error },
        );
      }
    }
    throw new Error(`${operationName}失败。`);
  }

  private async safeDelete(ffmpeg: FFmpeg, path: string): Promise<void> {
    try {
      await ffmpeg.deleteFile(path);
    } catch {
      // Best-effort cleanup of the in-memory FFmpeg filesystem.
    }
  }
}

export function isWasmMemoryFailure(error: unknown): boolean {
  const message = error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
  return /memory access out of bounds|out of memory|(?:wasm|webassembly)[^\n]*(?:trap|unreachable)/iu.test(message);
}
