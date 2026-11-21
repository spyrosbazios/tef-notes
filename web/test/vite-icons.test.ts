// The editor's stylesheet icons: lucide's own shapes in lucide's frame, one --icon-* variable each.
import { describe, expect, test } from "bun:test";
import { iconVars, svgOf } from "../vite-icons";

describe("editor icons", () => {
  test("an icon is lucide's frame around its shapes", () => {
    const svg = svgOf("Copy");
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"')).toBe(true);
    expect(svg).toContain('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"');
    expect(svg.endsWith("</svg>")).toBe(true);
  });
  test("one variable per name, kebab-cased, as a data URL", () => {
    const css = iconVars(["BookOpen", "ImageOff"]);
    expect(css).toMatch(/^:root \{\n {2}--icon-book-open: url\("data:image\/svg\+xml,%3Csvg/);
    expect(css).toContain("--icon-image-off: url(");
  });
});
