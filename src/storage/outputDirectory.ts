import type { GeneratedFile, JobDefinition } from "@/types";

export async function findExistingOutputFolders(
  root: FileSystemDirectoryHandle,
  jobs: JobDefinition[],
): Promise<string[]> {
  const existing: string[] = [];
  for (const job of jobs) {
    try {
      await root.getDirectoryHandle(job.folderName);
      existing.push(job.folderName);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
  }
  return existing;
}

export async function writeProjectOutput(
  root: FileSystemDirectoryHandle,
  folderName: string,
  files: GeneratedFile[],
): Promise<void> {
  const directory = await root.getDirectoryHandle(folderName, { create: true });
  await removeOldGeneratedFiles(directory);

  for (const output of files) {
    const handle = await directory.getFileHandle(output.name, { create: true });
    const writable = await handle.createWritable();
    const data =
      typeof output.data === "string"
        ? output.data
        : output.data.buffer.slice(
            output.data.byteOffset,
            output.data.byteOffset + output.data.byteLength,
          );
    await writable.write(data as FileSystemWriteChunkType);
    await writable.close();
  }
}

async function removeOldGeneratedFiles(
  directory: FileSystemDirectoryHandle,
): Promise<void> {
  for await (const entry of directory.values()) {
    if (entry.kind !== "file") continue;
    if (/^\d+\.mp3$/i.test(entry.name) || entry.name.toLowerCase().endsWith(".srt")) {
      await directory.removeEntry(entry.name);
    }
  }
}
