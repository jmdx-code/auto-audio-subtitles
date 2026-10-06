import { describe, expect, it } from "vitest";

import {
  parseDelimitedText,
  parseClipboardColumn,
  serializeDelimitedText,
} from "./clipboard";

describe("Google Sheets plain-text fallback", () => {
  it("parses rows and columns", () => {
    expect(parseDelimitedText("第一项\t忽略\n第二项\t忽略")).toEqual([
      ["第一项", "忽略"],
      ["第二项", "忽略"],
    ]);
  });

  it("preserves newlines inside a quoted cell", () => {
    expect(parseDelimitedText('"第一行\n第二行"\n"第三行"')).toEqual([
      ["第一行\n第二行"],
      ["第三行"],
    ]);
  });
});

describe("grid clipboard serialization", () => {
  it("copies rectangular cell ranges as spreadsheet-compatible TSV", () => {
    const text = serializeDelimitedText([
      ["第一行\n第二行", "项目 A"],
      ['含有"引号"', "项目 B"],
    ]);
    expect(parseDelimitedText(text)).toEqual([
      ["第一行\n第二行", "项目 A"],
      ['含有"引号"', "项目 B"],
    ]);
  });
});

describe("single-column spreadsheet detection", () => {
  it("preserves invalid numeric entities without throwing on untrusted clipboard HTML", () => {
    expect(parseClipboardColumn("", "<table><tr><td>&#1114112; &#xD800; &#x1F600;</td></tr></table>"))
      .toEqual(["&#1114112; &#xD800; 😀"]);
  });
  it("keeps quoted internal newlines in one cell", () => {
    expect(parseClipboardColumn('"第一段\r\n\r\n第二段\r\n第三段"')).toEqual([
      "第一段\n\n第二段\n第三段",
    ]);
  });

  it("preserves internal newlines across multiple quoted cells", () => {
    expect(parseClipboardColumn('"项目一第1行\n项目一第2行"\r\n"项目二第1行\n项目二第2行"')).toEqual([
      "项目一第1行\n项目一第2行",
      "项目二第1行\n项目二第2行",
    ]);
  });

  it("accepts plain one-column rows and rejects multiple columns", () => {
    expect(parseClipboardColumn("项目一\r\n项目二")).toEqual(["项目一", "项目二"]);
    expect(parseClipboardColumn("项目一\t名称一")).toBeNull();
  });

  it("uses the Google Sheets HTML table to preserve one multiline cell", () => {
    expect(
      parseClipboardColumn(
        "第一句\r\n第二句",
        '<google-sheets-html-origin><table><tbody><tr><td>第一句<br>第二句</td></tr></tbody></table></google-sheets-html-origin>',
      ),
    ).toEqual(["第一句\n第二句"]);
  });

  it("preserves multiline text in every pasted Google Sheets row", () => {
    expect(
      parseClipboardColumn(
        "项目一第1行\n项目一第2行\n项目二第1行\n项目二第2行",
        '<table><tr><td><span>项目一第1行</span><br>项目一第2行</td></tr><tr><td>项目二第1行<div>项目二第2行</div></td></tr></table>',
      ),
    ).toEqual([
      "项目一第1行\n项目一第2行",
      "项目二第1行\n项目二第2行",
    ]);
  });

  it("rejects a multi-column HTML range", () => {
    expect(
      parseClipboardColumn(
        "文案\t项目名",
        "<table><tr><td>文案</td><td>项目名</td></tr></table>",
      ),
    ).toBeNull();
  });
});
