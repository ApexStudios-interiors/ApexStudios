import { describe, expect, it } from "vitest";
import { takeNextQueued } from "./queue";

describe("takeNextQueued", () => {
  it("returns the first item when nothing has been removed", () => {
    const queue = [{ id: "a" }, { id: "b" }];
    expect(takeNextQueued(queue, new Set())).toEqual({ id: "a" });
    expect(queue).toEqual([{ id: "b" }]);
  });

  it("skips an item removed while it waited its turn", () => {
    // The bug this exists for: picking 4 photos queues the 4th behind the
    // 3 concurrent uploads. Removing it took it out of the tile list but not
    // out of the queue, so it uploaded anyway and ate a slot for good.
    const queue = [{ id: "a" }, { id: "b" }];
    expect(takeNextQueued(queue, new Set(["a"]))).toEqual({ id: "b" });
  });

  it("skips a run of removed items", () => {
    const queue = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(takeNextQueued(queue, new Set(["a", "b"]))).toEqual({ id: "c" });
    expect(queue).toEqual([]);
  });

  it("returns undefined when every queued item was removed", () => {
    expect(takeNextQueued([{ id: "a" }, { id: "b" }], new Set(["a", "b"]))).toBeUndefined();
  });

  it("returns undefined on an empty queue", () => {
    expect(takeNextQueued([], new Set(["a"]))).toBeUndefined();
  });

  it("forgets the ids it discarded, so the set cannot grow unboundedly", () => {
    const removed = new Set(["a", "b"]);
    takeNextQueued([{ id: "a" }, { id: "b" }, { id: "c" }], removed);
    expect(removed.size).toBe(0);
  });

  it("keeps the id of an item that is not in the queue (still uploading)", () => {
    // An in-flight upload is not in the queue; its id must survive so the
    // confirm step can delete the row it is about to create.
    const removed = new Set(["in-flight"]);
    takeNextQueued([{ id: "c" }], removed);
    expect(removed.has("in-flight")).toBe(true);
  });
});
