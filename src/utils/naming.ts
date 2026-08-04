import type { JobDefinition, ProjectRow } from "@/types";

export function sanitizePathSegment(value: string): string {
  const sanitized = value
    .replace(/[\\/*?:"<>|\u0000-\u001f]/g, "")
    .trim()
    .replace(/[. ]+$/g, "");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)
    ? `_${sanitized}`
    : sanitized;
}

export function localDateCode(date = new Date()): string {
  return `${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

export function createFolderName(
  projectName: string,
  sequence: number,
  date = new Date(),
): string {
  return `${localDateCode(date)}-${sanitizePathSegment(projectName)}-${String(sequence).padStart(2, "0")}`;
}

export function buildJobs(
  rows: ProjectRow[],
  startSequence: number,
  date = new Date(),
): JobDefinition[] {
  return rows
    .filter((row) => row.text.trim())
    .map((row, index) => {
      const sequence = startSequence + index;
      return {
        rowId: row.id,
        text: row.text,
        name: row.name,
        sequence,
        folderName: createFolderName(row.name, sequence, date),
      };
    });
}
