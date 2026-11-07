"use no memo";
// The widgets' looks. Android draws a widget from a description built once per redraw, so these are plain functions of
// their props (no hooks; the React Compiler is off for this file, which it would otherwise rewrite into hook calls).
// Colours are the owner's theme (packages/core/src/theme.ts), the face the app's (config.ts WIDGET_FONT), icons Lucide (icons.ts).
// Taps: OPEN_URI deep links into the app (a task, the Tasks tab's Today, widget/<action>); TICK comes back to
// handler.ts with the task's id.
import { FlexWidget, ListWidget, SvgWidget, TextWidget, type ColorProp } from "react-native-android-widget";
import type { Day, DayItem } from "@/core/today";
import type { Theme } from "@/core/theme";
import { WIDGET_FONT } from "./config";
import { ICONS, svgOf } from "./icons";

/** A tick (or untick) on a task's box: `clickActionData.id` is the task. */
export const TICK = "TICK";

const isColor = (c: string): c is ColorProp => /^#[0-9a-f]{6}$/i.test(c) || /^rgba\(/.test(c);
/** A palette colour as the widget takes one. */
function paint(c: string): ColorProp {
  if (!isColor(c)) throw new Error(`widget: ${c} is not a colour`);
  return c;
}

const open = (path: string) => ({ clickAction: "OPEN_URI", clickActionData: { uri: `tefnotes://${path}` } });

/** Most of the bar's segments, as on Home's card: past this many tasks a segment is a share of the day. */
const SEGMENTS = 10;

function Action({ theme, icon, label, wide, path }: { theme: Theme; icon: keyof typeof ICONS; label: string; wide: boolean; path: string }) {
  const { C, TINT } = theme;
  return (
    <FlexWidget {...open(path)} accessibilityLabel={label}
      style={{ flex: 1, height: "match_parent", flexDirection: "row", alignItems: "center", justifyContent: "center", flexGap: 8, borderRadius: 18, backgroundColor: paint(TINT.accent), paddingHorizontal: 10 }}>
      <SvgWidget svg={svgOf(ICONS[icon], C.brand)} style={{ width: 20, height: 20 }} />
      {wide ? <TextWidget text={label} maxLines={1} truncate="END" style={{ fontSize: 15, fontFamily: WIDGET_FONT.semi, color: paint(C.fg) }} /> : null}
    </FlexWidget>
  );
}

/** Ask (a fresh chat, its field focused) and New note, side by side; labels when there is room. */
export function QuickWidget({ theme, width }: { theme: Theme; width: number }) {
  const wide = width >= 200;
  return (
    <FlexWidget style={{ height: "match_parent", width: "match_parent", flexDirection: "row", flexGap: 8, padding: 8, borderRadius: 24, backgroundColor: paint(theme.C.card) }}>
      <Action theme={theme} icon="sparkles" label="Ask" wide={wide} path="widget/ask" />
      <Action theme={theme} icon="notebookPen" label="New note" wide={wide} path="widget/note" />
    </FlexWidget>
  );
}

/** A task's round box: open, a ring in the faint tone; ticked, the brand disc with a check. */
function Box({ theme, done, id, title }: { theme: Theme; done: boolean; id: string; title: string }) {
  const { C } = theme;
  return (
    // The tap target is wider than the ring, as the app's box has its hit slop
    <FlexWidget clickAction={TICK} clickActionData={{ id }} accessibilityLabel={done ? `Reopen ${title}` : `Done: ${title}`}
      style={{ width: 40, height: "match_parent", alignItems: "center", justifyContent: "center" }}>
      <FlexWidget style={{ width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", ...(done ? { backgroundColor: paint(C.brand) } : { borderWidth: 2, borderColor: paint(C.faint) }) }}>
        {done ? <SvgWidget svg={svgOf(ICONS.check, C.bg, 3.4)} style={{ width: 14, height: 14 }} /> : null}
      </FlexWidget>
    </FlexWidget>
  );
}

function Row({ theme, item, done }: { theme: Theme; item: DayItem; done: boolean }) {
  const { C } = theme;
  return (
    <FlexWidget {...open(`task/${item.id}`)} accessibilityLabel={item.title}
      style={{ width: "match_parent", flexDirection: "row", alignItems: "center", paddingVertical: 6, paddingRight: 8 }}>
      <Box theme={theme} done={done} id={item.id} title={item.title} />
      <FlexWidget style={{ flex: 1, flexDirection: "column" }}>
        <TextWidget text={item.title} maxLines={1} truncate="END" style={{ fontSize: 15, fontFamily: WIDGET_FONT.regular, color: paint(done ? C.dim : C.fg) }} />
      </FlexWidget>
    </FlexWidget>
  );
}

function Divider({ theme }: { theme: Theme }) {
  const { C } = theme;
  return (
    <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", flexGap: 6, paddingTop: 10, paddingBottom: 2, paddingLeft: 10 }}>
      <SvgWidget svg={svgOf(ICONS.moon, C.brand)} style={{ width: 14, height: 14 }} />
      <TextWidget text="This Evening" style={{ fontSize: 13, fontFamily: WIDGET_FONT.bold, color: paint(C.fg) }} />
    </FlexWidget>
  );
}

const countLine = (d: Day) => (d.total ? `${d.done.length} of ${d.total} done` : "Nothing planned");

/** Today: the count (and the bar when there is height for it), then the open tasks, This Evening's under their heading,
 *  then the ones ticked today, faded, whose box takes the tick back. Too low for a list: the count and the next task. */
export function TodayWidget({ theme, day, width, height }: { theme: Theme; day: Day; width: number; height: number }) {
  const { C, TINT } = theme;
  const compact = height < 130, wide = width >= 250;
  const n = Math.min(day.total, SEGMENTS), lit = day.total ? Math.round((day.done.length / day.total) * n) : 0;
  const firstEvening = day.open.findIndex((i) => i.evening);
  const next = day.open[0];

  const header = (
    <FlexWidget style={{ width: "match_parent", flexDirection: "row", alignItems: "center", flexGap: 6 }}>
      <FlexWidget {...open("today?list=today")} accessibilityLabel={`Today: ${countLine(day)}`} style={{ flex: 1, flexDirection: "column", paddingLeft: 4 }}>
        <TextWidget text="Today" style={{ fontSize: 13, fontFamily: WIDGET_FONT.semi, color: paint(C.brand) }} />
        <TextWidget text={countLine(day)} maxLines={1} truncate="END" style={{ fontSize: 18, fontFamily: WIDGET_FONT.bold, color: paint(C.fg) }} />
      </FlexWidget>
      {wide ? (
        <FlexWidget {...open("widget/ask")} accessibilityLabel="Ask" style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: paint(TINT.accent) }}>
          <SvgWidget svg={svgOf(ICONS.sparkles, C.brand)} style={{ width: 20, height: 20 }} />
        </FlexWidget>
      ) : null}
      {wide ? (
        <FlexWidget {...open("widget/note")} accessibilityLabel="New note" style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: paint(TINT.accent) }}>
          <SvgWidget svg={svgOf(ICONS.notebookPen, C.brand)} style={{ width: 20, height: 20 }} />
        </FlexWidget>
      ) : null}
    </FlexWidget>
  );

  const bar = n ? (
    <FlexWidget style={{ width: "match_parent", height: 6, flexDirection: "row", flexGap: 4, marginTop: 8, paddingHorizontal: 4 }}>
      {Array.from({ length: n }, (_, i) => (
        <FlexWidget key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: paint(i < lit ? C.brand : TINT.muted) }} />
      ))}
    </FlexWidget>
  ) : null;

  const body = compact ? (
    next ? <Row theme={theme} item={next} done={false} /> : null
  ) : day.total ? (
    <ListWidget style={{ width: "match_parent", height: "match_parent", marginTop: 6 }}>
      {day.open.flatMap((item, i) => [
        i === firstEvening ? <Divider key="evening" theme={theme} /> : null,
        <Row key={item.id} theme={theme} item={item} done={false} />,
      ]).filter((x) => x !== null)}
      {day.done.map((item) => <Row key={item.id} theme={theme} item={item} done />)}
    </ListWidget>
  ) : (
    <FlexWidget {...open("today?list=today")} style={{ width: "match_parent", height: "match_parent", flexDirection: "column", alignItems: "center", justifyContent: "center", flexGap: 6 }}>
      <SvgWidget svg={svgOf(ICONS.calendarCheck, C.dim)} style={{ width: 24, height: 24 }} />
      <TextWidget text="Nothing for today" style={{ fontSize: 14, fontFamily: WIDGET_FONT.regular, color: paint(C.dim) }} />
    </FlexWidget>
  );

  return (
    <FlexWidget style={{ width: "match_parent", height: "match_parent", flexDirection: "column", padding: 12, borderRadius: 24, backgroundColor: paint(C.card) }}>
      {header}
      {compact ? null : bar}
      {body}
    </FlexWidget>
  );
}
