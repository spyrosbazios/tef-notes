// Settings → Layout: each layout's own preferences (core/prefs.ts): where the app opens, Home's list, the phone's tabs, the desktop's sidebar.
import { ChevronDown, Monitor, Smartphone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { HIDEABLE, LAYOUT_LABEL, movedTab, RAIL, RAIL_LABEL, START_LABEL, STARTS, TAB_LABELS, TAB_LABELS_LABEL, TAB_LABEL, OPENING_LISTS, type Layout, type LayoutPrefs, type Tab } from "@/core/prefs";
import { TASK_LIST_LABEL } from "@/core/things";
import { Choice } from "@/components/settings/choice";
import { TITLE } from "@/components/settings/style";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRowDrag } from "@/hooks/drag";
import { prefsNow, setPrefs, usePrefs } from "@/hooks/prefs";
import { TAB_ICON } from "@/components/tab-icons";
import { RAIL_ICON } from "@/components/task-icons";
import { useLayout } from "@/hooks/media";
import { useOffered } from "@/hooks/talk";
import { cn } from "@/lib/utils";

/** What a phone tab's row opens to, when it has a choice of its own. */
function TabOptions({ tab }: { tab: Tab }) {
  const { homeList, tasksList } = usePrefs().phone;
  if (tab === "home") return (
    <div className="space-y-2 pb-1"><p className="text-[13px] text-dim">Home's task box opens on</p>
      <Choice label="Home's task box opens on" value={homeList} options={OPENING_LISTS} names={TASK_LIST_LABEL} onPick={(v) => setPrefs({ phone: { homeList: v } })} /></div>
  );
  if (tab === "tasks") return (
    <div className="space-y-2 pb-1"><p className="text-[13px] text-dim">The Tasks tab opens on</p>
      <Choice label="The Tasks tab opens on" value={tasksList} options={OPENING_LISTS} names={TASK_LIST_LABEL} onPick={(v) => setPrefs({ phone: { tasksList: v } })} /></div>
  );
  return null;
}

const setLayout = (layout: Layout, patch: Partial<LayoutPrefs>) => setPrefs(layout === "phone" ? { phone: patch } : { desktop: patch });

/** One layout's preferences (core/prefs.ts): its rows. */
function LayoutCard({ layout, children }: { layout: Layout; children: ReactNode }) {
  return (
    <div className="divide-y divide-line rounded-xl border border-line">
      <StartRow layout={layout} />
      {children}
    </div>
  );
}

function StartRow({ layout }: { layout: Layout }) {
  const { start } = usePrefs()[layout];
  return (
    <div className="space-y-2.5 px-3 py-2.5">
      <p className="text-sm font-semibold">Open the app on</p>
      <Choice label={`Open the app on, ${LAYOUT_LABEL[layout]}`} value={start} options={STARTS} names={START_LABEL} onPick={(v) => setLayout(layout, { start: v })} />
    </div>
  );
}

/** The phone's bottom bar: the tabs dragged into order (a finger after a long press), shown or hidden, and Home and Tasks tapped
 *  open for the list each starts on. */
function PhoneLayout() {
  const { tabs: stored, hidden, tabLabels } = usePrefs().phone;
  const offered = useOffered(), tabs = stored.filter(offered);
  const [open, setOpen] = useState<Tab | null>(null);
  const drag = useRowDrag((_g, id, over, after) => setPrefs({ phone: { tabs: movedTab(prefsNow().phone.tabs, id as Tab, over as Tab, after) } }));
  return (
    <LayoutCard layout="phone">
      <div className="space-y-2.5 px-3 py-2.5">
        <p className="text-sm font-semibold">Tab labels</p>
        <Choice label="Tab labels" value={tabLabels} options={TAB_LABELS} names={TAB_LABELS_LABEL} onPick={(v) => setPrefs({ phone: { tabLabels: v } })} />
      </div>
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">Tabs</p>
        <p className="text-[13px] leading-snug text-dim">Drag to reorder. Tap Home or Tasks for the list it opens on.</p>
      </div>
      <ul aria-label="Tabs" className="divide-y divide-line">
        {tabs.map((t) => {
          const shown = !hidden.includes(t), d = drag("tabs", t), opens = t === "home" || t === "tasks", Icon = TAB_ICON[t];
          return (
            <li key={t} {...d.props} className={cn("relative select-none", d.dragging && "opacity-40")}>
              {d.mark ? <span aria-hidden className={cn("pointer-events-none absolute inset-x-3 h-0.5 rounded-full bg-brand", d.mark === "before" ? "-top-px" : "-bottom-px")} /> : null}
              <div className="flex items-center gap-2 px-1.5 py-1">
                <button type="button" disabled={!opens} aria-expanded={opens ? open === t : undefined} onClick={() => setOpen(open === t ? null : t)}
                  className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring enabled:hover:bg-muted">
                  <Icon className={cn("size-4 shrink-0", shown ? "text-brand" : "text-faint")} />
                  <span className={cn("min-w-0 flex-1 text-sm", !shown && "text-faint")}>{TAB_LABEL[t]}</span>
                  {opens ? <ChevronDown className={cn("size-4 text-faint transition-transform", open === t && "rotate-180")} /> : null}
                </button>
                {HIDEABLE.includes(t) ? (
                  <Switch checked={shown} aria-label={`Show ${TAB_LABEL[t]}`} className="mr-1.5"
                    onCheckedChange={(on) => setPrefs({ phone: { hidden: on ? hidden.filter((h) => h !== t) : [...hidden, t] } })} />
                ) : null}
              </div>
              {open === t ? <div className="pr-3 pl-12"><TabOptions tab={t} /></div> : null}
            </li>
          );
        })}
      </ul>
    </LayoutCard>
  );
}

/** The desktop's: Home's list, and the screens the sidebar lists. */
function DesktopLayout() {
  const { homeList, hidden } = usePrefs().desktop;
  const offered = useOffered();
  return (
    <LayoutCard layout="desktop">
      <div className="space-y-2.5 px-3 py-2.5">
        <p className="text-sm font-semibold">Home's task box opens on</p>
        <Choice label="Home's task box opens on, Desktop" value={homeList} options={OPENING_LISTS} names={TASK_LIST_LABEL} onPick={(v) => setPrefs({ desktop: { homeList: v } })} />
      </div>
      <div className="px-3 py-2.5">
        <p className="text-sm font-semibold">Sidebar</p>
        <p className="text-[13px] leading-snug text-dim">Home, Search and Settings always stay.</p>
      </div>
      <ul aria-label="Sidebar" className="divide-y divide-line">
        {RAIL.filter(offered).map((r) => {
          const shown = !hidden.includes(r), Icon = RAIL_ICON[r];
          return (
            <li key={r}>
              <label className="flex min-h-12 items-center gap-2.5 px-3 py-1">
                <Icon className={cn("size-4 shrink-0", shown ? "text-brand" : "text-faint")} />
                <span className={cn("min-w-0 flex-1 text-sm", !shown && "text-faint")}>{RAIL_LABEL[r]}</span>
                <Switch checked={shown} aria-label={`Show ${RAIL_LABEL[r]} in the sidebar`}
                  onCheckedChange={(on) => setPrefs({ desktop: { hidden: on ? hidden.filter((h) => h !== r) : [...hidden, r] } })} />
              </label>
            </li>
          );
        })}
      </ul>
    </LayoutCard>
  );
}

/** Each layout's own preferences, a tab apiece, the one this window is drawn in first. */
export function Layouts() {
  const here = useLayout();
  return (
    <section className="space-y-3" aria-labelledby="layout-h">
      <h2 id="layout-h" className={TITLE}>Layout</h2>
      <Tabs defaultValue={here} className="space-y-3">
        <TabsList>
          <TabsTrigger value="phone"><Smartphone /> Phone</TabsTrigger>
          <TabsTrigger value="desktop"><Monitor /> Web</TabsTrigger>
        </TabsList>
        <TabsContent value="phone"><PhoneLayout /></TabsContent>
        <TabsContent value="desktop"><DesktopLayout /></TabsContent>
      </Tabs>
    </section>
  );
}
