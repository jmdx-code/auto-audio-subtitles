import { describe, expect, it } from "vitest";

import {
  createUnifiedSrt,
  endPaddingForText,
  groupSegments,
  readWavDuration,
  splitTextLines,
} from "./timing";

describe("audio timing", () => {
  it("uses long padding for configured punctuation", () => {
    for (const ending of ["。", "！", "？", ".", "!", "?", "။", "၊", "”", '"']) {
      expect(endPaddingForText(`测试${ending}`)).toBe(0.5);
    }
    expect(endPaddingForText("测试，")).toBe(0.2);
  });

  it("ignores empty lines", () => {
    expect(splitTextLines(" 第一行 \n\n 第二行\r\n ")).toEqual(["第一行", "第二行"]);
  });

  it("splits only between segments and allows an oversized segment", () => {
    const segments = [
      { text: "a", tempFileName: "a.wav", duration: 4 },
      { text: "b", tempFileName: "b.wav", duration: 8 },
      { text: "c", tempFileName: "c.wav", duration: 2 },
    ];
    expect(groupSegments(segments, 5).map((group) => group.map((item) => item.text))).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });

  it("creates one continuous SRT timeline", () => {
    const srt = createUnifiedSrt([
      { text: "第一行", tempFileName: "1.wav", duration: 1.25 },
      { text: "第二行", tempFileName: "2.wav", duration: 2 },
    ]);
    expect(srt).toContain("00:00:00,000 --> 00:00:01,250");
    expect(srt).toContain("00:00:01,250 --> 00:00:03,250");
  });

  it("reads PCM WAV duration from its chunks", () => {
    const wav = new Uint8Array(44 + 48_000);
    const view = new DataView(wav.buffer);
    writeAscii(view, 0, "RIFF");
    view.setUint32(4, wav.length - 8, true);
    writeAscii(view, 8, "WAVE");
    writeAscii(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 24_000, true);
    view.setUint32(28, 48_000, true);
    writeAscii(view, 36, "data");
    view.setUint32(40, 48_000, true);
    expect(readWavDuration(wav)).toBe(1);
  });
});

function writeAscii(view: DataView, offset: number, value: string) {
  Array.from(value).forEach((character, index) => {
    view.setUint8(offset + index, character.charCodeAt(0));
  });
}
