import { describe, expect, it } from "vitest";

import { createFolderName } from "./naming";

describe("output naming", () => {
  it("keeps an empty project-name field", () => {
    expect(createFolderName("", 1, new Date(2026, 7, 3))).toBe("0803--01");
  });

  it("removes characters that are invalid on Windows", () => {
    expect(createFolderName('新闻:测试/一', 12, new Date(2026, 7, 3))).toBe(
      "0803-新闻测试一-12",
    );
  });

  it("avoids Windows reserved directory names", () => {
    expect(createFolderName("CON", 3, new Date(2026, 7, 3))).toBe("0803-_CON-03");
  });
});
