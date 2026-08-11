import { describe, expect, it } from "vitest";

import { isWasmMemoryFailure } from "./AudioEngine";

describe("isWasmMemoryFailure", () => {
  it("recognizes WebAssembly memory traps", () => {
    expect(
      isWasmMemoryFailure(new WebAssembly.RuntimeError("memory access out of bounds")),
    ).toBe(true);
    expect(isWasmMemoryFailure(new Error("WebAssembly trap: unreachable"))).toBe(true);
    expect(isWasmMemoryFailure("RuntimeError: out of memory")).toBe(true);
  });

  it("does not retry ordinary FFmpeg failures", () => {
    expect(isWasmMemoryFailure(new Error("静音裁剪失败（FFmpeg 1）。"))).toBe(false);
    expect(isWasmMemoryFailure(new Error("网络连接失败"))).toBe(false);
  });
});
