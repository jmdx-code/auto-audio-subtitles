import { FFmpeg } from "@ffmpeg/ffmpeg";

import {
  AUDIO_BITRATE,
  AUDIO_SAMPLE_RATE,
  SILENCE_THRESHOLD,
  START_PADDING_SECONDS,
} from "@/const";

export class AudioEngine {
  private readonly ffmpeg = new FFmpeg();
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly onLog?: (message: string) => void) {
    this.ffmpeg.on("log", ({ message }) => this.onLog?.(message));
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.ffmpeg
        .load({
          coreURL: chrome.runtime.getURL("vendor/ffmpeg-core.js"),
          wasmURL: chrome.runtime.getURL("vendor/ffmpeg-core.wasm"),
        })
        .then(() => undefined)
        .catch((error) => {
          this.loadPromise = null;
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
    await this.ensureLoaded();
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
      await this.ffmpeg.writeFile(input, audio);
      const code = await this.ffmpeg.exec([
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
      const result = await this.ffmpeg.readFile(output);
      if (typeof result === "string") throw new Error("FFmpeg 返回了错误的音频格式。");
      return new Uint8Array(result);
    } finally {
      await this.safeDelete(input);
      await this.safeDelete(output);
    }
  }

  async encodeMp3(
    wavFiles: Uint8Array[],
    uniqueId: string,
  ): Promise<Uint8Array> {
    await this.ensureLoaded();
    const inputNames = wavFiles.map(
      (_file, index) => `${uniqueId}-input-${String(index).padStart(3, "0")}.wav`,
    );
    const listName = `${uniqueId}-concat.txt`;
    const outputName = `${uniqueId}-output.mp3`;

    try {
      for (let index = 0; index < wavFiles.length; index += 1) {
        await this.ffmpeg.writeFile(inputNames[index], wavFiles[index]);
      }
      await this.ffmpeg.writeFile(
        listName,
        new TextEncoder().encode(
          inputNames.map((name) => `file '${name}'`).join("\n"),
        ),
      );
      const code = await this.ffmpeg.exec([
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
      const result = await this.ffmpeg.readFile(outputName);
      if (typeof result === "string") throw new Error("FFmpeg 返回了错误的 MP3 格式。");
      return new Uint8Array(result);
    } finally {
      await Promise.all([
        ...inputNames.map((name) => this.safeDelete(name)),
        this.safeDelete(listName),
        this.safeDelete(outputName),
      ]);
    }
  }

  terminate(): void {
    this.ffmpeg.terminate();
    this.loadPromise = null;
  }

  private async safeDelete(path: string): Promise<void> {
    try {
      await this.ffmpeg.deleteFile(path);
    } catch {
      // Best-effort cleanup of the in-memory FFmpeg filesystem.
    }
  }
}
