// NDJSON / line-delimited JSON splitter for backend stdout/stderr.
// Scans lines with a configurable line cap.
// (Pi needs 32 MB lines because it embeds full message partials in each
// `message_update` event.)

const DEFAULT_MAX_LINE = 1024 * 1024; // 1 MiB

export interface NdjsonOptions {
  /** Max bytes per line. Lines that exceed this are silently dropped. */
  maxLineBytes?: number;
  /**
   * Called for each raw line that fails JSON.parse. Default: silent.
   * Use this to log scanner failures while still iterating cleanly.
   */
  onParseError?: (line: string, err: Error) => void;
}

/**
 * Yields one parsed JSON value per non-empty line read from `stream`.
 * Closes when stream EOFs. Bytes that don't parse as JSON are skipped
 * (with optional onParseError callback) so a single garbled line doesn't
 * abort the whole session.
 */
export async function* readNdjson<T = unknown>(
  stream: ReadableStream<Uint8Array>,
  opts: NdjsonOptions = {},
): AsyncGenerator<T, void, unknown> {
  const maxLine = opts.maxLineBytes ?? DEFAULT_MAX_LINE;
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (value && value.length > 0) {
        buf += decoder.decode(value, { stream: true });
      }
      let nl = buf.indexOf("\n");
      while (nl !== -1) {
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
        if (line.length > 0 && line.length <= maxLine) {
          try {
            yield JSON.parse(line) as T;
          } catch (e) {
            opts.onParseError?.(line, e as Error);
          }
        }
        nl = buf.indexOf("\n");
      }
      if (done) {
        // Flush any final partial line.
        if (buf.length > 0 && buf.length <= maxLine) {
          try {
            yield JSON.parse(buf) as T;
          } catch (e) {
            opts.onParseError?.(buf, e as Error);
          }
        }
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
