import {
  LONG_END_PADDING_SECONDS,
  SHORT_END_PADDING_SECONDS,
} from "@/const";
import type { SegmentInfo } from "@/types";

const LONG_ENDING = /[。！？.!?။၊”"]$/u;

export function endPaddingForText(text: string): number {
  return LONG_ENDING.test(text.trim())
    ? LONG_END_PADDING_SECONDS
    : SHORT_END_PADDING_SECONDS;
}

export function splitTextLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function groupSegments(
  segments: SegmentInfo[],
  maximumSeconds: number,
): SegmentInfo[][] {
  const groups: SegmentInfo[][] = [];
  let current: SegmentInfo[] = [];
  let duration = 0;

  for (const segment of segments) {
    if (current.length > 0 && duration + segment.duration > maximumSeconds) {
      groups.push(current);
      current = [];
      duration = 0;
    }
    current.push(segment);
    duration += segment.duration;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

export function formatSrtTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

export function createUnifiedSrt(segments: SegmentInfo[]): string {
  let cursor = 0;
  return segments
    .map((segment, index) => {
      const start = cursor;
      cursor += segment.duration;
      return `${index + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(cursor)}\n${segment.text}\n`;
    })
    .join("\n");
}

export function readWavDuration(data: Uint8Array): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.byteLength < 44 || readAscii(view, 0, 4) !== "RIFF") {
    throw new Error("FFmpeg 返回了无效的 WAV 文件。");
  }

  let byteRate = 0;
  let dataLength = 0;
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readAscii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && size >= 12) byteRate = view.getUint32(offset + 16, true);
    if (id === "data") {
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (byteRate <= 0 || dataLength <= 0) {
    throw new Error("无法读取 WAV 音频时长。");
  }
  return dataLength / byteRate;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += String.fromCharCode(view.getUint8(offset + index));
  }
  return result;
}
