// Downloads a file counting its bytes, for the start screen's «Cargando motor 18 / 31 MB». ffmpeg.wasm
// fetches the core by itself without telling how far it is; fetching it first lets the service
// worker cache it, and ffmpeg then reads it from there.

export type OnBytes = (loaded: number, total: number) => void;

/**
 * `total` is known at build time: Content-Length would be the compressed size where the server
 * compresses, while the reader counts decompressed bytes.
 */
export async function download(url: string, total: number, onBytes: OnBytes, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
  const reader = response.body.getReader();
  let loaded = 0;
  onBytes(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    loaded += value.byteLength;
    onBytes(loaded, Math.max(total, loaded));
  }
}
