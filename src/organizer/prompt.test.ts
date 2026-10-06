import { describe, expect, it } from "vitest";
import { cleanOrganizerResult } from "./prompt";
import { buildJobs } from "@/utils/naming";

describe("organizer output to audio", () => {
  it("preserves Myanmar lines and passes them to the existing audio job", () => {
    const text = cleanOrganizerResult("```text\r\n မင်္ဂလာပါ။ \r\n\r\n နေကောင်းပါသလား။ \r\n```");
    expect(text).toBe("မင်္ဂလာပါ။\nနေကောင်းပါသလား။");
    const jobs = buildJobs([{ id: "test", rawText: "မင်္ဂလာပါ။ နေကောင်းပါသလား။", text,
      name: "test", status: "idle", progress: 0, detail: "" }], 1);
    expect(jobs[0].text.split("\n")).toHaveLength(2);
  });

  it.each(["", "Quota exceeded", "Here is your result"])("rejects non-Myanmar responses: %s", (text) => {
    expect(() => cleanOrganizerResult(text)).toThrow("有效缅文");
  });
});
