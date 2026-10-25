import { describe, expect, it } from "vitest";
import {
  formatEta,
  formatFps,
  formatMatchDate,
  formatReadyBy,
  formatSize,
  formatSpeed,
  formatVideoTime,
} from "@/lib/labels";
import {
  halfDuration,
  maxSubstitutionMinute,
  minutesPlayed,
  parseClock,
  validateMarkers,
  videoMsToMatchClock,
} from "@/lib/match-clock";

// C06 acceptance (SQUAD06): minutes played are right across substitutions. And
// the MATCH05 clock from the four markers (docs/build/design/C06.md, Surface 5).

const MIN = 60;

describe("minutesPlayed", () => {
  it("gives a full starter the whole match", () => {
    expect(minutesPlayed({ startedAt: 0, endedAt: null }, 45)).toBe(90);
  });

  it("stops a starter at the minute they went off", () => {
    expect(minutesPlayed({ startedAt: 0, endedAt: 60 * MIN }, 45)).toBe(60);
  });

  it("starts a substitute at the minute they came on", () => {
    expect(minutesPlayed({ startedAt: 60 * MIN, endedAt: null }, 45)).toBe(30);
  });

  it("counts a substitute who came on and went off again", () => {
    expect(minutesPlayed({ startedAt: 70 * MIN, endedAt: 85 * MIN }, 45)).toBe(15);
  });

  it("gives an unused substitute 0", () => {
    expect(minutesPlayed({ startedAt: null, endedAt: null }, 45)).toBe(0);
  });

  it("keeps the minutes of a player who went off with no replacement", () => {
    // Injury at 38': the row ends there whether or not anyone came on.
    expect(minutesPlayed({ startedAt: 0, endedAt: 38 * MIN }, 45)).toBe(38);
  });

  it("follows the half length: 2 x 35 is 70 minutes", () => {
    expect(minutesPlayed({ startedAt: 0, endedAt: null }, 35)).toBe(70);
    expect(minutesPlayed({ startedAt: 50 * MIN, endedAt: null }, 35)).toBe(20);
  });

  it("does not count stoppage time past the regulation end", () => {
    expect(minutesPlayed({ startedAt: 0, endedAt: 93 * MIN }, 45)).toBe(90);
    expect(minutesPlayed({ startedAt: 92 * MIN, endedAt: null }, 45)).toBe(0);
  });

  it("allows substitutions up to 2 x half + 15", () => {
    expect(maxSubstitutionMinute(45)).toBe(105);
    expect(maxSubstitutionMinute(30)).toBe(75);
  });
});

const markers = {
  kickoffMs: 151_000, // 2:31
  halfTimeMs: 151_000 + 47 * 60_000, // 47 min first half (45+2)
  secondHalfKickoffMs: 151_000 + 62 * 60_000,
  fullTimeMs: 151_000 + 62 * 60_000 + 48 * 60_000,
};

describe("videoMsToMatchClock", () => {
  it("needs kickoff", () => {
    expect(videoMsToMatchClock(10_000, {}, 45)).toBeNull();
  });

  it("is before kickoff before the first whistle", () => {
    expect(videoMsToMatchClock(1000, markers, 45)).toEqual({
      phase: "before_kickoff",
      label: "",
      stoppage: null,
    });
  });

  it("counts the first half from kickoff", () => {
    const c = videoMsToMatchClock(markers.kickoffMs + (31 * 60 + 24) * 1000, markers, 45);
    expect(c).toEqual({ phase: "first_half", label: "31:24", stoppage: null });
  });

  it("shows first-half stoppage as 45+2", () => {
    const c = videoMsToMatchClock(markers.kickoffMs + (46 * 60 + 30) * 1000, markers, 45);
    expect(c).toEqual({ phase: "first_half", label: "45+1:30", stoppage: "45+2" });
  });

  it("is half-time between the two whistles", () => {
    const c = videoMsToMatchClock(markers.halfTimeMs + 5 * 60_000, markers, 45);
    expect(c?.phase).toBe("half_time");
    expect(c?.label).toBe("");
  });

  it("starts the second half at 45:00", () => {
    expect(videoMsToMatchClock(markers.secondHalfKickoffMs, markers, 45)?.label).toBe("45:00");
    expect(videoMsToMatchClock(markers.secondHalfKickoffMs + 30 * 60_000, markers, 45)).toEqual({
      phase: "second_half",
      label: "75:00",
      stoppage: null,
    });
  });

  it("shows second-half stoppage as 90+n and ends at full time", () => {
    const c = videoMsToMatchClock(markers.secondHalfKickoffMs + 46 * 60_000 + 10_000, markers, 45);
    expect(c?.stoppage).toBe("90+2");
    expect(videoMsToMatchClock(markers.fullTimeMs, markers, 45)?.phase).toBe("after_full_time");
  });

  it("uses the half length: a 30-minute half's second half starts at 30:00", () => {
    expect(videoMsToMatchClock(markers.secondHalfKickoffMs, markers, 30)?.label).toBe("30:00");
  });

  it("refuses markers out of order", () => {
    const bad = { ...markers, halfTimeMs: markers.kickoffMs - 1000 };
    expect(videoMsToMatchClock(markers.kickoffMs + 60_000, bad, 45)).toBeNull();
  });
});

describe("validateMarkers", () => {
  it("accepts ordered markers, blanks and an equal half-time and second-half kickoff", () => {
    expect(validateMarkers(markers)).toEqual({});
    expect(validateMarkers({ kickoffMs: 1000, fullTimeMs: 2000 })).toEqual({});
    expect(validateMarkers({ halfTimeMs: 5000, secondHalfKickoffMs: 5000 })).toEqual({});
  });

  it("names the marker that is out of order, with the C06 copy", () => {
    expect(validateMarkers({ kickoffMs: 5000, halfTimeMs: 5000 })).toEqual({
      halfTimeMs: "Half-time must be after kickoff.",
    });
    expect(validateMarkers({ halfTimeMs: 5000, secondHalfKickoffMs: 4000 })).toEqual({
      secondHalfKickoffMs: "Second-half kickoff must be at or after half-time.",
    });
    expect(validateMarkers({ secondHalfKickoffMs: 5000, fullTimeMs: 5000 })).toEqual({
      fullTimeMs: "Full time must be after second-half kickoff.",
    });
  });

  it("compares with the nearest earlier marker that is set", () => {
    expect(validateMarkers({ kickoffMs: 5000, fullTimeMs: 1000 })).toEqual({
      fullTimeMs: "Full time must be after kickoff.",
    });
  });
});

describe("parseClock and formatVideoTime", () => {
  it("reads typed times", () => {
    expect(parseClock("2:31")).toBe(151_000);
    expect(parseClock("47:12.4")).toBe(2_832_400);
    expect(parseClock(" 112:31.0 ")).toBe(6_751_000);
    expect(parseClock("1:5")).toBeNull();
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("2:61")).toBeNull();
  });

  it("formats video positions with and without a decimal", () => {
    expect(formatVideoTime(2_832_400)).toBe("47:12.4");
    expect(formatVideoTime(6_751_000)).toBe("112:31.0");
    expect(formatVideoTime(2_832_400, 0)).toBe("47:12");
    expect(formatVideoTime(0)).toBe("0:00.0");
  });

  it("round-trips", () => {
    for (const ms of [0, 151_000, 2_832_400, 6_751_900]) {
      expect(parseClock(formatVideoTime(ms))).toBe(ms);
    }
  });

  it("gives a half's length and clock", () => {
    expect(halfDuration(0, 47 * 60_000, 45, 0)).toEqual({ minutes: 47, clock: "45+2" });
    expect(halfDuration(0, 45 * 60_000, 45, 45)).toEqual({ minutes: 45, clock: "90" });
  });

  it("gives a short half the clock it reached, not the full length", () => {
    expect(halfDuration(0, 40 * 60_000, 45, 0)).toEqual({ minutes: 40, clock: "40" });
    expect(halfDuration(0, 43 * 60_000, 45, 45)).toEqual({ minutes: 43, clock: "88" });
    // Kickoff 0:05, half-time 2:40 on a 2 x 10 match.
    expect(halfDuration(5_000, 160_000, 10, 0)).toEqual({ minutes: 3, clock: "3" });
  });
});

describe("C06 labels", () => {
  it("formats sizes, speeds, time left and frame rates", () => {
    expect(formatSize(450_400_000)).toBe("450 MB");
    expect(formatSize(4_800_000_000)).toBe("4.8 GB");
    expect(formatSpeed(3_412_000)).toBe("3.4 MB/s");
    expect(formatSpeed(50_000)).toBe("under 0.1 MB/s");
    expect(formatEta(30)).toBe("under 1 min");
    expect(formatEta(11 * 60 + 5)).toBe("12 min");
    expect(formatEta(80 * 60)).toBe("1 h 20 min");
    expect(formatEta(120 * 60)).toBe("2 h");
    expect(formatFps(23.976)).toBe("24");
    expect(formatFps(29.97)).toBe("30");
    expect(formatFps(12.5)).toBe("12.5");
  });

  it("formats match dates and ready-by times in South Africa", () => {
    expect(formatMatchDate(new Date("2026-10-18T10:00:00+02:00"))).toBe("Sun 18 Oct 2026");
    const now = new Date("2026-10-24T09:00:00+02:00");
    expect(formatReadyBy(new Date("2026-10-24T15:40:00+02:00"), now)).toBe("15:40");
    expect(formatReadyBy(new Date("2026-10-25T09:10:00+02:00"), now)).toBe("09:10 tomorrow");
    expect(formatReadyBy(new Date("2026-10-27T09:10:00+02:00"), now)).toBe("Tue 27 Oct, 09:10");
  });
});
