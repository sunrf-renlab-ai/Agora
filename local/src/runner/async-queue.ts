// Tiny single-producer/single-consumer queue exposed as AsyncIterable.
// Used by the runner backends to stream messages between producer and consumer.

export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private closed = false;
  private err: Error | null = null;

  push(item: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  close(err?: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.err = err ?? null;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift();
      if (!w) break;
      if (this.err) w(Promise.reject(this.err) as never);
      else w({ value: undefined, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.items.length > 0) {
          const value = this.items.shift() as T;
          return Promise.resolve({ value, done: false });
        }
        if (this.closed) {
          if (this.err) return Promise.reject(this.err);
          return Promise.resolve({ value: undefined as unknown as T, done: true });
        }
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: async (): Promise<IteratorResult<T>> => {
        this.close();
        return { value: undefined as unknown as T, done: true };
      },
    };
  }
}
