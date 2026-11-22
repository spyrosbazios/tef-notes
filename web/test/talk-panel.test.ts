import { expect, test } from "bun:test";
import { clampGap, PANEL_MARGIN } from "@/lib/talk-panel";

test("a gap inside the window is kept, rounded", () => {
  expect(clampGap(200.4, 1000)).toBe(200);
});

test("the panel never passes the edge it is measured from", () => {
  expect(clampGap(-80, 1000)).toBe(PANEL_MARGIN);
});

test("nor the far edge: the gap stops a margin short of the room there is", () => {
  expect(clampGap(5000, 1000)).toBe(1000 - PANEL_MARGIN);
});

test("a window with no room to spare holds the panel at the margin", () => {
  expect(clampGap(300, 10)).toBe(PANEL_MARGIN);
});
