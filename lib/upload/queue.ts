/**
 * The upload queue's one non-obvious rule, kept out of `FileUploader` so it
 * can be tested without a DOM.
 *
 * `FileUploader` uploads at most `MAX_CONCURRENT` (3) files at once but
 * accepts up to `MAX_PHOTOS_PER_ENTITY` (4), so a selection can leave files
 * waiting. A waiting file can be removed from the form before its turn comes,
 * and an upload already in flight cannot be recalled at all. Neither may end
 * up as a live `attachments` row: `requestUploadUrl` counts every row for the
 * entity against the 4-photo cap, so a row with no tile on screen consumes a
 * slot that nothing can ever give back.
 */

/** The shape `takeNextQueued` needs; the component's `UploadItem` satisfies it. */
export type Queued = { id: string };

/**
 * Pops the next item that is still wanted, discarding any the user removed
 * while it waited. Mutates `queue` (it is the component's live ref) and
 * clears each discarded id out of `removed`, so the set does not grow across
 * a long session. Returns `undefined` when nothing is left to upload.
 */
export function takeNextQueued<T extends Queued>(queue: T[], removed: Set<string>): T | undefined {
  let item = queue.shift();
  while (item && removed.has(item.id)) {
    removed.delete(item.id);
    item = queue.shift();
  }
  return item;
}
