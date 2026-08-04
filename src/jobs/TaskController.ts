export class TaskCancelledError extends Error {
  constructor() {
    super("任务已取消");
    this.name = "TaskCancelledError";
  }
}

export class TaskController {
  private paused = false;
  private cancelled = false;
  private resumeResolvers: Array<() => void> = [];

  get isPaused(): boolean {
    return this.paused;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  pause(): void {
    if (!this.cancelled) this.paused = true;
  }

  resume(): void {
    this.paused = false;
    for (const resolve of this.resumeResolvers.splice(0)) resolve();
  }

  cancel(): void {
    this.cancelled = true;
    this.resume();
  }

  async checkpoint(): Promise<void> {
    if (this.cancelled) throw new TaskCancelledError();
    if (this.paused) {
      await new Promise<void>((resolve) => this.resumeResolvers.push(resolve));
    }
    if (this.cancelled) throw new TaskCancelledError();
  }
}
