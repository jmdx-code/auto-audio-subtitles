import { AudioEngine } from "@/audio/AudioEngine";
import {
  createUnifiedSrt,
  endPaddingForText,
  groupSegments,
  readWavDuration,
  splitTextLines,
} from "@/audio/timing";
import type { TtsProvider } from "@/providers/types";
import { readTempFile, removeTempJob, writeTempFile } from "@/storage/tempStore";
import { writeProjectOutput } from "@/storage/outputDirectory";
import type {
  AppSettings,
  GeneratedFile,
  JobDefinition,
  ProjectRow,
  SegmentInfo,
} from "@/types";
import { TaskCancelledError, TaskController } from "./TaskController";

type RowPatch = Partial<Pick<ProjectRow, "status" | "progress" | "detail" | "error">>;

export type BatchRunnerEvents = {
  updateRow(rowId: string, patch: RowPatch): void;
  log(message: string): void;
};

export type BatchRunResult = {
  completed: string[];
  failed: string[];
  cancelled: boolean;
};

export class BatchRunner {
  constructor(
    private readonly provider: TtsProvider,
    private readonly audio: AudioEngine,
    private readonly outputRoot: FileSystemDirectoryHandle,
    private readonly settings: AppSettings,
    private readonly controller: TaskController,
    private readonly events: BatchRunnerEvents,
  ) {}

  async run(jobs: JobDefinition[]): Promise<BatchRunResult> {
    const completed: string[] = [];
    const failed: string[] = [];

    await this.audio.ensureLoaded();
    for (const job of jobs) {
      try {
        await this.controller.checkpoint();
        this.events.updateRow(job.rowId, {
          status: "processing",
          progress: 1,
          detail: "正在准备项目…",
          error: undefined,
        });
        await this.processJob(job);
        completed.push(job.rowId);
        this.events.updateRow(job.rowId, {
          status: "completed",
          progress: 100,
          detail: "生成完成",
          error: undefined,
        });
      } catch (error) {
        await removeTempJob(job.rowId).catch(() => undefined);
        if (error instanceof TaskCancelledError) {
          this.events.updateRow(job.rowId, {
            status: "idle",
            progress: 0,
            detail: "已取消",
          });
          return { completed, failed, cancelled: true };
        }
        const message = error instanceof Error ? error.message : String(error);
        failed.push(job.rowId);
        this.events.updateRow(job.rowId, {
          status: "failed",
          detail: "生成失败",
          error: message,
        });
        this.events.log(`${job.folderName}：${message}`);
      }
    }
    return { completed, failed, cancelled: false };
  }

  private async processJob(job: JobDefinition): Promise<void> {
    const lines = splitTextLines(job.text);
    if (lines.length === 0) throw new Error("项目没有有效文案。");

    const segments: SegmentInfo[] = [];
    try {
      for (let index = 0; index < lines.length; index += 1) {
        await this.controller.checkpoint();
        const line = lines[index];
        this.events.updateRow(job.rowId, {
          progress: Math.max(2, Math.round((index / lines.length) * 70)),
          detail: `正在生成片段 ${index + 1}/${lines.length}`,
        });
        const audioBlob = await this.synthesizeWithRetry(line, job, index, lines.length);
        await this.controller.checkpoint();
        const wav = await this.audio.trimToWav(
          new Uint8Array(await audioBlob.arrayBuffer()),
          `${job.rowId}-${index}`,
          endPaddingForText(line),
        );
        const tempFileName = `segment-${String(index).padStart(4, "0")}.wav`;
        await writeTempFile(job.rowId, tempFileName, wav);
        segments.push({
          text: line,
          tempFileName,
          duration: readWavDuration(wav),
        });
      }

      const groups = groupSegments(segments, this.settings.maxSegmentSeconds);
      const outputs: GeneratedFile[] = [];
      for (let index = 0; index < groups.length; index += 1) {
        await this.controller.checkpoint();
        this.events.updateRow(job.rowId, {
          progress: 72 + Math.round((index / groups.length) * 20),
          detail: `正在合并音频 ${index + 1}/${groups.length}`,
        });
        const wavFiles = await Promise.all(
          groups[index].map((segment) =>
            readTempFile(job.rowId, segment.tempFileName),
          ),
        );
        const mp3 = await this.audio.encodeMp3(
          wavFiles,
          `${job.rowId}-group-${index}`,
        );
        outputs.push({
          name: `${String(index + 1).padStart(2, "0")}.mp3`,
          data: mp3,
        });
      }

      outputs.push({
        name: `${job.folderName}.srt`,
        data: createUnifiedSrt(segments),
      });
      await this.controller.checkpoint();
      this.events.updateRow(job.rowId, {
        progress: 95,
        detail: "正在写入输出目录…",
      });
      await writeProjectOutput(this.outputRoot, job.folderName, outputs);
    } finally {
      await removeTempJob(job.rowId).catch(() => undefined);
    }
  }

  private async synthesizeWithRetry(
    text: string,
    job: JobDefinition,
    segmentIndex: number,
    totalSegments: number,
  ): Promise<Blob> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await this.controller.checkpoint();
      try {
        return await this.provider.synthesize(text, {
          voice: this.settings.selectedVoice,
          rate: formatRate(this.settings.rate),
          pitch: formatPitch(this.settings.pitch),
        });
      } catch (error) {
        lastError = error;
        if (attempt === 3) break;
        this.events.updateRow(job.rowId, {
          detail: `片段 ${segmentIndex + 1}/${totalSegments} 失败，正在第 ${attempt + 1} 次尝试…`,
        });
        await wait(attempt * 1000);
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`片段 ${segmentIndex + 1} 连续生成失败：${detail}`);
  }
}

export function formatRate(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
}

export function formatPitch(value: number): string {
  return `${value >= 0 ? "+" : ""}${Math.round(value)}Hz`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
