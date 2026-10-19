// Kompres/dekompres teks JSON dengan gzip (CompressionStream bawaan browser dan Node 18+).
// Dipakai agar state dashboard yang besar tetap muat di batas body request/response Vercel (±4,5 MB).

export const BODY_ENCODING_HEADER = "x-body-encoding";
export const ACCEPT_BODY_ENCODING_HEADER = "x-accept-body-encoding";
// Data di bawah ukuran ini dikirim apa adanya.
export const GZIP_THRESHOLD_BYTES = 256 * 1024;

export function canGzip() {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}

export async function gzipText(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipToText(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
