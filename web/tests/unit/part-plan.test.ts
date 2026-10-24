import { describe, expect, it } from "vitest";
import {
  MAX_PARTS,
  MIN_PART_SIZE,
  partCount,
  partRange,
  partSizeFor,
  videoKind,
} from "@/lib/upload/part-plan";

// MATCH02: the multipart plan shared by the uploader and the upload service.

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

describe("part plan", () => {
  it("uses 8 MiB parts for a 20 MiB file: three parts", () => {
    const size = 20 * MiB;
    expect(partSizeFor(size)).toBe(MIN_PART_SIZE);
    expect(partCount(size, partSizeFor(size))).toBe(3);
    expect(partRange(3, size, MIN_PART_SIZE)).toEqual({ start: 16 * MiB, end: 20 * MiB });
  });

  it("stays within 10,000 parts for 8 GiB and much larger files", () => {
    for (const size of [8 * GiB, 80 * GiB, 200 * GiB]) {
      const part = partSizeFor(size);
      expect(part).toBeGreaterThanOrEqual(MIN_PART_SIZE);
      expect(partCount(size, part)).toBeLessThanOrEqual(MAX_PARTS);
      expect(part % MiB).toBe(0);
    }
  });

  it("covers every byte exactly once", () => {
    const size = 20 * MiB + 17;
    const part = partSizeFor(size);
    let next = 0;
    for (let n = 1; n <= partCount(size, part); n++) {
      const { start, end } = partRange(n, size, part);
      expect(start).toBe(next);
      next = end;
    }
    expect(next).toBe(size);
  });

  it("accepts MP4 and MOV by extension and MIME type", () => {
    expect(videoKind("Match.MP4", "video/mp4")).toBe("mp4");
    expect(videoKind("match.mov", "video/quicktime")).toBe("mov");
    // Some systems report no type, or a generic one, for MOV files.
    expect(videoKind("match.mov", "")).toBe("mov");
    expect(videoKind("match.mp4", "application/octet-stream")).toBe("mp4");
  });

  it("refuses other types", () => {
    expect(videoKind("match.avi", "video/x-msvideo")).toBeNull();
    expect(videoKind("match.mkv", "video/x-matroska")).toBeNull();
    expect(videoKind("match.mp4", "text/plain")).toBeNull();
    expect(videoKind("match", "video/mp4")).toBeNull();
    expect(videoKind("lineup.csv", "text/csv")).toBeNull();
  });
});
