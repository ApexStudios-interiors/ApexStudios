/**
 * build/06-files-jobs-daily-updates.md §2.1. Exported as data, not just used
 * server-side, so the client's `accept`/size hint and the server's real check
 * (features/attachments/actions.ts) read from exactly one source — the build
 * file's own warning that "the client's accept attribute is a convenience,
 * not a control" only holds if there is nowhere for the two to drift apart.
 */
export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const DOC_MIME = ["application/pdf"] as const;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DOC_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_PHOTOS_PER_ENTITY = 4; // matches the UI's 4-photo grids

export type AllowedMime = (typeof IMAGE_MIME)[number] | (typeof DOC_MIME)[number];

export function isAllowedMime(mime: string): mime is AllowedMime {
  return (IMAGE_MIME as readonly string[]).includes(mime) || (DOC_MIME as readonly string[]).includes(mime);
}

export function maxBytesFor(mime: string): number {
  return (IMAGE_MIME as readonly string[]).includes(mime) ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
}
