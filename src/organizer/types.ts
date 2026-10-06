export type StudioModelOption = { id: string; label: string; paid: boolean };
export type StudioModelsResult = { currentModelId: string; models: StudioModelOption[] };
export type StudioPromptResult = { ok: boolean; text: string; error: string; elapsedMs: number };
export type StudioRequest =
  | { action: "ping" }
  | { action: "models" }
  | { action: "run"; prompt: string; modelId: string; timeoutMs: number };
