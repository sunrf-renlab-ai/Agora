export class ChildTracker {
  private pids = new Set<number>();
  add(pid: number): void {
    this.pids.add(pid);
  }
  remove(pid: number): void {
    this.pids.delete(pid);
  }
  size(): number {
    return this.pids.size;
  }
  list(): number[] {
    return [...this.pids];
  }
  clear(): void {
    this.pids.clear();
  }
}

export async function killAllChildren(
  tracker: ChildTracker,
  sigkillAfterMs = 5_000,
): Promise<void> {
  const pids = tracker.list();
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  await new Promise((r) => setTimeout(r, sigkillAfterMs));
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  tracker.clear();
}
