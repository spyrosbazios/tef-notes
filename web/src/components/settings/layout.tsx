// Settings → Layout: each layout's own preferences (core/prefs.ts): where the app opens and the list each screen opens on, the
// phone's tabs (dragged into order, shown or hidden), the desktop's assistant button and sidebar.
import { AudioLines, Captions, Ellipsis, MessageCircle, Monitor, Rocket, Smartphone } from "lucide-react";
import type { ReactNode } from "react";
import { FAB_ACTION_LABEL, FAB_ACTIONS, HIDEABLE, movedTab, RAIL, RAIL_LABEL, START_LABEL, STARTS, TAB_LABELS, TAB_LABELS_LABEL, TAB_LABEL, OPENING_LISTS, type FabAction, type Layout, type LayoutPrefs, type Tab } from "@/core/prefs";
import { TASK_LIST_LABEL, type TaskList } from "@/core/things";
import { Choose, DragItem, Grip, Group, Page, Row, type Option } from "@/components/settings/kit";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRowDrag } from "@/hooks/drag";
import { prefsNow, setPrefs, usePrefs } from "@/hooks/prefs";
import { TAB_ICON } from "@/components/tab-icons";
import { RAIL_ICON, TASK_ICON } from "@/components/task-icons";
import { useLayout } from "@/hooks/media";
import { useOffered, useTalkOn } from "@/hooks/talk";

type Start = (typeof STARTS)[number];
const START_ICON = { home: TAB_ICON.home, inbox: TASK_ICON.inbox, today: TASK_ICON.today, upcoming: TASK_ICON.upcoming, notes: TAB_ICON.notes };
const startOf = (s: Start): Option => ({ label: START_LABEL[s], icon: START_ICON[s] });
const listOf = (l: TaskList): Option => ({ label: TASK_LIST_LABEL[l], icon: TASK_ICON[l] });
const FAB_ICON = { chat: MessageCircle, talk: AudioLines, menu: Ellipsis };
const fabOf = (f: FabAction): Option => ({ label: FAB_ACTION_LABEL[f], icon: FAB_ICON[f] });

/** Where a layout opens: the screen, then the list each task screen starts on. */
function Opening({ layout }: { layout: Layout }) {
  const all = usePrefs(), p = all[layout];
  const set = (patch: Partial<LayoutPrefs>) => setPrefs(layout === "phone" ? { phone: patch } : { desktop: patch });
  return (
    <Group title="Opens on">
      <Row icon={Rocket} title="App">
        <Choose label="Open the app on" value={p.start} options={STARTS} of={startOf} onPick={(v) => set({ start: v })} />
      </Row>
      <Row icon={TAB_ICON.home} title="Home's task box">
        <Choose label="Home's task box opens on" value={p.homeList} options={OPENING_LISTS} of={listOf} onPick={(v) => set({ homeList: v })} />
      </Row>
      {layout === "phone" ? (
        <Row icon={TAB_ICON.tasks} title="Tasks tab">
          <Choose label="The Tasks tab opens on" value={all.phone.tasksList} options={OPENING_LISTS} of={listOf} onPick={(v) => setPrefs({ phone: { tasksList: v } })} />
        </Row>
      ) : null}
    </Group>
  );
}

/** The phone's bottom bar: its labels, and the tabs dragged into order (a finger after a long press), shown or hidden. */
function PhoneLayout() {
  const { tabs: stored, hidden, tabLabels } = usePrefs().phone;
  const offered = useOffered(), tabs = stored.filter(offered);
  const drag = useRowDrag((_g, id, over, after) => setPrefs({ phone: { tabs: movedTab(prefsNow().phone.tabs, id as Tab, over as Tab, after) } }));
  return (
    <>
      <Opening layout="phone" />
      <Group title="Tab bar" hint="Drag to reorder.">
        <Row icon={Captions} title="Labels">
          <Choose label="Tab labels" value={tabLabels} options={TAB_LABELS} of={(v) => ({ label: TAB_LABELS_LABEL[v] })} onPick={(v) => setPrefs({ phone: { tabLabels: v } })} />
        </Row>
        <ul aria-label="Tabs" className="divide-y divide-line">
          {tabs.map((t) => {
            const shown = !hidden.includes(t);
            return (
              <DragItem key={t} drag={drag("tabs", t)}>
                <Row lead={<Grip />} icon={TAB_ICON[t]} tone={shown ? "brand" : "dim"} off={!shown} title={TAB_LABEL[t]}>
                  {HIDEABLE.includes(t) ? (
                    <Switch checked={shown} aria-label={`Show ${TAB_LABEL[t]}`}
                      onCheckedChange={(on) => setPrefs({ phone: { hidden: on ? hidden.filter((h) => h !== t) : [...hidden, t] } })} />
                  ) : null}
                </Row>
              </DragItem>
            );
          })}
        </ul>
      </Group>
    </>
  );
}

/** The desktop's: the assistant's round button, and the screens the sidebar lists. */
function DesktopLayout() {
  const { hidden, fab } = usePrefs().desktop;
  const offered = useOffered(), talkOn = useTalkOn();
  return (
    <>
      <Opening layout="desktop" />
      {talkOn ? (
        <Group title="Assistant button">
          <Row icon={MessageCircle} title="Opens">
            <Choose label="The assistant's button opens" value={fab} options={FAB_ACTIONS} of={fabOf} onPick={(v) => setPrefs({ desktop: { fab: v } })} />
          </Row>
        </Group>
      ) : null}
      <Group title="Sidebar" hint="Search and Settings always stay; the logo always leads Home.">
        <ul aria-label="Sidebar" className="divide-y divide-line">
          {RAIL.filter(offered).map((r) => {
            const shown = !hidden.includes(r);
            return (
              <li key={r}>
                <Row icon={RAIL_ICON[r]} tone={shown ? "brand" : "dim"} off={!shown} title={RAIL_LABEL[r]}>
                  <Switch checked={shown} aria-label={`Show ${RAIL_LABEL[r]} in the sidebar`}
                    onCheckedChange={(on) => setPrefs({ desktop: { hidden: on ? hidden.filter((h) => h !== r) : [...hidden, r] } })} />
                </Row>
              </li>
            );
          })}
        </ul>
      </Group>
    </>
  );
}

/** A tab apiece for the layouts, the one this window is drawn in first: Settings → Layout and → Notes. */
export function LayoutTabs({ phone, desktop }: { phone: ReactNode; desktop: ReactNode }) {
  const here = useLayout();
  return (
    <Tabs defaultValue={here} className="space-y-6">
      <TabsList>
        <TabsTrigger value="phone"><Smartphone /> Phone</TabsTrigger>
        <TabsTrigger value="desktop"><Monitor /> Web</TabsTrigger>
      </TabsList>
      <TabsContent value="phone" className="space-y-6">{phone}</TabsContent>
      <TabsContent value="desktop" className="space-y-6">{desktop}</TabsContent>
    </Tabs>
  );
}

export function Layouts() {
  return (
    <Page title="Layout">
      <LayoutTabs phone={<PhoneLayout />} desktop={<DesktopLayout />} />
    </Page>
  );
}
