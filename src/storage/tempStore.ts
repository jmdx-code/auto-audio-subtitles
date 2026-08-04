const ROOT_NAME = "tts-temporary-audio";

async function getTempRoot(): Promise<FileSystemDirectoryHandle> {
  const originRoot = await navigator.storage.getDirectory();
  return originRoot.getDirectoryHandle(ROOT_NAME, { create: true });
}

async function getJobDirectory(
  jobId: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  const root = await getTempRoot();
  return root.getDirectoryHandle(jobId, { create });
}

export async function writeTempFile(
  jobId: string,
  fileName: string,
  data: Uint8Array,
): Promise<void> {
  const directory = await getJobDirectory(jobId, true);
  const file = await directory.getFileHandle(fileName, { create: true });
  const writable = await file.createWritable();
  await writable.write(toArrayBuffer(data));
  await writable.close();
}

export async function readTempFile(
  jobId: string,
  fileName: string,
): Promise<Uint8Array> {
  const directory = await getJobDirectory(jobId, false);
  const file = await (await directory.getFileHandle(fileName)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

export async function removeTempJob(jobId: string): Promise<void> {
  try {
    const root = await getTempRoot();
    await root.removeEntry(jobId, { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
}

export async function cleanupAllTempJobs(): Promise<void> {
  const root = await getTempRoot();
  for await (const entry of root.values()) {
    await root.removeEntry(entry.name, { recursive: true });
  }
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}
