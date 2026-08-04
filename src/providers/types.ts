import type { SynthesisOptions } from "@/types";

export interface TtsProvider {
  synthesize(text: string, options: SynthesisOptions): Promise<Blob>;
}
