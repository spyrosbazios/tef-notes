import { describe, expect, it } from "bun:test";
import { dayLabel, dayParts, everyLabel, parseWhen, whenLabel } from "../src/dates";

// 2026-10-31 is a Saturday.
const T = "2026-10-31";
const when = (s: string) => parseWhen(s, T);

describe("parseWhen", () => {
  it("reads the plain words", () => {
    expect(when("today")).toEqual({ when: T, evening: false });
    expect(when("  Tomorrow ")).toEqual({ when: "2026-11-01", evening: false });
    expect(when("tmr")).toEqual({ when: "2026-11-01", evening: false });
    expect(when("someday")).toBeNull();
  });
  it("reads this evening", () => {
    expect(when("tonight")).toEqual({ when: T, evening: true });
    expect(when("this evening")).toEqual({ when: T, evening: true });
    expect(when("fri evening")).toEqual({ when: "2026-11-06", evening: true });
    expect(when("tomorrow evening")).toEqual({ when: "2026-11-01", evening: true });
  });
  it("reads a weekday as the next one after today", () => {
    expect(when("fri")).toEqual({ when: "2026-11-06", evening: false });
    expect(when("Friday")).toEqual({ when: "2026-11-06", evening: false });
    expect(when("next fri")).toEqual({ when: "2026-11-06", evening: false });
    expect(when("sat")).toEqual({ when: "2026-11-07", evening: false });
    expect(when("tues")).toEqual({ when: "2026-11-03", evening: false });
    expect(when("next week")).toEqual({ when: "2026-11-02", evening: false });
  });
  it("reads a span from today", () => {
    expect(when("in 3d")).toEqual({ when: "2026-11-03", evening: false });
    expect(when("3d")).toEqual({ when: "2026-11-03", evening: false });
    expect(when("+2w")).toEqual({ when: "2026-11-14", evening: false });
    expect(when("in 2 weeks")).toEqual({ when: "2026-11-14", evening: false });
    expect(when("in a month")).toEqual({ when: "2026-11-30", evening: false });
    expect(when("in 1 year")).toEqual({ when: "2027-10-31", evening: false });
    expect(when("next month")).toEqual({ when: "2026-11-30", evening: false });
  });
  it("reads a date, in the year it next falls", () => {
    expect(when("nov 12")).toEqual({ when: "2026-11-12", evening: false });
    expect(when("12 November")).toEqual({ when: "2026-11-12", evening: false });
    expect(when("Sept 3rd")).toEqual({ when: "2027-09-03", evening: false });
    expect(when("oct 31")).toEqual({ when: T, evening: false });
    expect(when("oct 30")).toEqual({ when: "2027-10-30", evening: false });
    expect(when("jan 5 2028")).toEqual({ when: "2028-01-05", evening: false });
    expect(when("2026-12-24")).toEqual({ when: "2026-12-24", evening: false });
  });
  it("refuses what is not a day", () => {
    for (const s of ["", "soon", "feb 30", "2026-02-30", "nov", "in 3", "tu", "blah evening"]) expect(when(s), s).toBeNull();
  });
});

describe("labels", () => {
  it("names a day near today by the word", () => {
    expect(dayLabel(T, T)).toBe("Today");
    expect(dayLabel("2026-11-01", T)).toBe("Tomorrow");
    expect(dayLabel("2026-10-30", T)).toBe("Yesterday");
    expect(dayLabel("2026-11-06", T)).toBe("Friday");
    expect(dayLabel("2026-11-12", T)).toBe("Nov 12");
    expect(dayLabel("2027-01-05", T)).toBe("Jan 5 2027");
  });
  it("splits a heading into label and detail", () => {
    expect(dayParts("2026-11-01", T)).toEqual({ label: "Tomorrow", detail: "Nov 1" });
    expect(dayParts("2026-11-06", T)).toEqual({ label: "Friday", detail: "Nov 6" });
    expect(dayParts("2026-11-12", T)).toEqual({ label: "Nov 12", detail: "Thursday" });
  });
  it("says what a schedule is", () => {
    expect(whenLabel({ when: T, evening: true }, T)).toBe("This Evening");
    expect(whenLabel({ when: "2026-11-06", evening: true }, T)).toBe("Friday evening");
    expect(whenLabel({ when: "2026-11-12" }, T)).toBe("Nov 12");
    expect(whenLabel({}, T)).toBeNull();
  });
  it("says what repeats", () => {
    expect(everyLabel("1w")).toBe("Every week");
    expect(everyLabel("2d")).toBe("Every 2 days");
    expect(everyLabel("+3d")).toBe("3 days after done");
    expect(everyLabel("mon,thu")).toBe("Every Mon, Thu");
  });
});
