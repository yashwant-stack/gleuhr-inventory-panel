// An encrypted copy of the panel's live data, for a page published on a public link.
// The data is gzipped, then encrypted with AES-256-GCM under a key derived from the panel's access key
// (PBKDF2-SHA-256, 600,000 rounds). The page holds only this blob; it opens in the browser, and only
// with the right key. preview/encrypt-snapshot.mjs makes the blob with exactly these parameters.

export interface SnapshotBlob {
  v: 1;
  iter: number;
  salt: string;
  iv: string;
  data: string;
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class WrongKey extends Error {}

/** The data's JSON text, or WrongKey when the key does not open it. */
export async function decryptSnapshot(blob: SnapshotBlob, key: string): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const base = await subtle.importKey("raw", new TextEncoder().encode(key.trim()), "PBKDF2", false, ["deriveKey"]);
  const aes = await subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(blob.salt), iterations: blob.iter, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  let zipped: ArrayBuffer;
  try {
    zipped = await subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, aes, fromB64(blob.data));
  } catch {
    throw new WrongKey("That key is not right.");
  }
  const stream = new Blob([zipped]).stream().pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).text();
}
