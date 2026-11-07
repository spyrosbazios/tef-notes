// Settings' sub-pages, one per category: Appearance (theme and primary colour), Server (address, sync, conflicts), Photos
// (Wi-Fi uploads), Agent (model, write cards, its memory) and Tags. The Settings tab lists them (`SECTIONS`);
// app/settings/[section].tsx shows one. The server's address goes to SecureStore (src/store/keys.ts); prefs to MMKV (src/store/prefs.ts).
import * as Haptics from "expo-haptics";
import { Camera, Check, Palette, PenLine, RefreshCw, Server, Sparkles, Tag as TagIcon, Wifi, type LucideIcon } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { serverUrl } from "@/core/pocketbase";
import { hm } from "@/core/time";
import { useModel } from "@/store/agent";
import { useKeys } from "@/store/keys";
import { setServer, syncNotes, useNoteText, useNotes } from "@/store/notes";
import { usePrefs } from "@/store/prefs";
import { EnrichedMarkdownText } from "react-native-enriched-markdown";
import { MEMORY } from "@/core/notes";
import { Conflicts } from "@/ui/conflicts";
import { Button, Input, ListRow, ListSection, Sheet, Switch, T } from "@/ui/ds";
import { ModelSheet } from "@/ui/models";
import { FLAGS, useMarkdownStyle } from "@/ui/note";
import { TagList } from "@/ui/tag-list";
import { ACCENT_NAMES, ACCENTS, accentColor, THEME_NAMES, THEMES, withAccent, type AccentName, type ThemeName } from "@/core/theme";
import { chooseAccent, chooseTheme, useTheme } from "@/ui/use-theme";

/** What each theme is for, under its name. */
const ABOUT: Record<ThemeName, string> = {
  oled: "True black. Easiest on the battery at night.",
  dark: "Dark grey, softer than black.",
  midnight: "Deep navy, cooler than grey.",
  forest: "Green-black, calm and earthy.",
  mocha: "Catppuccin's pastels on a cosy dark.",
  nord: "Arctic blue-grey, dimmed and calm.",
  rosepine: "Faux fur and pine: plum dark, rose brand.",
  tokyo: "Downtown lights on a night-blue ground.",
  gruvbox: "Retro groove: warm greys, cream text.",
  light: "Near-white, for daylight.",
  mist: "Cool blue-grey daylight.",
  dawn: "Soft blush paper, warm and bright.",
  sepia: "Warm paper, low glare for reading.",
  latte: "Catppuccin's pastels in daylight.",
  snow: "Nord's snow storm, inked in polar night.",
  solar: "Solarized's cream, blue on yellowed paper.",
};

/** A theme's look in small: its ground, a card on it, and its brand (the picked accent on it). */
function Swatch({ name }: { name: ThemeName }) {
  const { C } = withAccent(THEMES[name], usePrefs((s) => s.accent));
  return (
    <View className="h-10 w-10 items-center justify-center rounded-xl border" style={{ backgroundColor: C.bg, borderColor: C.line }}>
      <View className="h-5 w-6 items-end justify-end rounded-md p-[3px]" style={{ backgroundColor: C.card }}>
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: C.brand }} />
      </View>
    </View>
  );
}

function Appearance() {
  const { name, C } = useTheme();
  return (
    <ListSection title="Theme">
      {THEME_NAMES.map((n) => (
        <ListRow key={n} title={THEMES[n].label} subtitle={ABOUT[n]} leading={<Swatch name={n} />} selected={n === name}
          onPress={() => { if (n !== name) { void Haptics.selectionAsync(); chooseTheme(n); } }}
          trailing={n === name ? <Check size={20} color={C.brand} strokeWidth={2.6} /> : null} />
      ))}
    </ListSection>
  );
}

/** The primary colour: a dot per accent in the tone it takes on this theme, the first the theme's own. */
function Accent() {
  const theme = useTheme();
  const accent = usePrefs((s) => s.accent);
  const label = (a: AccentName) => (a === "theme" ? `${THEMES[theme.name].label}'s own` : ACCENTS[a].label);
  return (
    <ListSection title="Primary colour" footer={label(accent)}>
      <View className="flex-row flex-wrap gap-3 px-4 py-4">
        {ACCENT_NAMES.map((a) => {
          const on = a === accent, colour = accentColor(THEMES[theme.name], a);
          return (
            <Pressable key={a} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={label(a)} hitSlop={4}
              onPress={() => { if (!on) { void Haptics.selectionAsync(); chooseAccent(a); } }}
              className="h-12 w-12 items-center justify-center rounded-full border-2 active:opacity-80"
              style={{ borderColor: on ? colour : "transparent" }}>
              <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: colour }}>
                {on ? <Check size={18} color={theme.C.bg} strokeWidth={3} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </ListSection>
  );
}

/** A row with a switch at its end: the whole row flips it. */
function ToggleRow({ title, subtitle, icon, value, onChange }: { title: string; subtitle: string; icon: typeof Wifi; value: boolean; onChange: (v: boolean) => void }) {
  const flip = (v: boolean) => { void Haptics.selectionAsync(); onChange(v); };
  return (
    <ListRow title={title} subtitle={subtitle} icon={icon} onPress={() => flip(!value)}
      trailing={<Switch checked={value} onCheckedChange={flip} accessibilityLabel={title} />} />
  );
}

/** The server's address: the host in a row, the field in a sheet. A save that took closes the sheet with a success tap. */
function ServerSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const stored = useKeys((s) => s.keys.server) ?? "";
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const value = draft ?? stored, dirty = serverUrl(value) !== stored;
  const shut = (o: boolean) => { if (!o) { setDraft(null); setErr(null); } onOpenChange(o); };
  const save = () => {
    const e = setServer(value);
    setErr(e);
    if (e) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    shut(false);
  };
  return (
    <Sheet open={open} onOpenChange={shut} title="Server">
      <View className="gap-3">
        <Input value={value} onChangeText={setDraft} onSubmitEditing={save} label="Address" hint="Your TEF Notes server: https://host:port" error={err ?? undefined}
          accessibilityLabel="Server address" autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="not set" returnKeyType="done" submitBehavior="submit" />
        <Button onPress={save} disabled={!dirty}>Save</Button>
      </View>
    </Sheet>
  );
}

/** agent/memory.md: the agent's notes about the owner, which it rewrites itself (it syncs down like a note). Shown, not edited here: it is the agent's record, not a note. */
function Memory() {
  const md = useMarkdownStyle();
  const raw = useNoteText(MEMORY), known = useNotes((s) => !!s.notes[MEMORY]), text = raw?.trim();
  return (
    <ListSection title="Agent memory" footer="The agent (Ask, here and on the web) keeps this file about you and how you keep notes, and rewrites it on its own.">
      <View className="px-4 py-3">
        {text ? <EnrichedMarkdownText flavor="github" markdown={text} markdownStyle={md} selectable md4cFlags={FLAGS} />
          : <T tone="faint" size={14}>{raw == null && known ? "Not on this phone yet. It downloads on the next sync." : "Empty: the agent hasn't written anything yet."}</T>}
      </View>
    </ListSection>
  );
}

function ServerPage() {
  const { C } = useTheme();
  const keys = useKeys((s) => s.keys);
  const sync = useNotes((s) => s.sync);
  const [serving, setServing] = useState(false);
  const canSync = !!keys.server && sync.state !== "syncing";
  const host = keys.server?.replace(/^https?:\/\//, "");
  const syncLine = {
    off: "No server: notes stay on this phone", idle: sync.at ? `Last synced ${hm(sync.at / 1000)}` : "Connected", syncing: "Syncing…",
    error: `Failed: ${sync.err}`, conflict: `${sync.conflicts ?? 0} note${sync.conflicts === 1 ? "" : "s"} changed here and on the server: pick a side`,
  }[sync.state];
  return (
    <View className="gap-3">
      <ListSection title="Server" footer="Notes, photos and the agent's memory live there. No sign-in: the server must only be reachable on a private network.">
        <ListRow title="Server" subtitle={host || "Not set"} icon={Server} chevron onPress={() => setServing(true)} />
        <ListRow title="Sync now" subtitle={syncLine} icon={RefreshCw} disabled={!canSync} onPress={() => syncNotes()}
          trailing={sync.state === "syncing" ? <ActivityIndicator size="small" color={C.brand} /> : null} />
      </ListSection>
      <Conflicts />
      <ServerSheet open={serving} onOpenChange={setServing} />
    </View>
  );
}

function PhotosPage() {
  const prefs = usePrefs();
  return (
    <ListSection title="Photos">
      <ToggleRow title="Upload on Wi-Fi only" subtitle="Photos wait for Wi-Fi. Notes sync as usual." icon={Wifi}
        value={prefs.photosWifiOnly} onChange={(v) => prefs.set({ photosWifiOnly: v })} />
    </ListSection>
  );
}

function AgentPage() {
  const prefs = usePrefs();
  const { model, models } = useModel();
  const [choosing, setChoosing] = useState(false);
  const agent = models.data ? (models.data.web ? "Searches the web" : "No web search on the server") : undefined;
  return (
    <>
      <ListSection title="Agent" footer={agent}>
        <ListRow title="Model" subtitle={model ?? "None"} icon={Sparkles} chevron onPress={() => setChoosing(true)} />
        <ToggleRow title="Write notes without asking" subtitle="Off: each change waits for your OK. Always asked after it read the web." icon={PenLine}
          value={prefs.agentWritesWithoutAsking} onChange={(v) => prefs.set({ agentWritesWithoutAsking: v })} />
      </ListSection>
      <Memory />
      <ModelSheet open={choosing} onOpenChange={setChoosing} />
    </>
  );
}

export type SectionId = "appearance" | "server" | "photos" | "agent" | "tags";

/** The categories, in the order the Settings tab lists them. */
export const SECTIONS: Record<SectionId, { title: string; about: string; icon: LucideIcon; Page: () => ReactNode }> = {
  appearance: { title: "Appearance", about: "Theme and primary colour", icon: Palette, Page: () => <><Appearance /><Accent /></> },
  server: { title: "Server & sync", about: "Address, sync, conflicts", icon: Server, Page: ServerPage },
  photos: { title: "Photos", about: "Uploads on Wi-Fi", icon: Camera, Page: PhotosPage },
  agent: { title: "Agent", about: "Model, write confirmations, memory", icon: Sparkles, Page: AgentPage },
  tags: { title: "Tags", about: "Colours and descriptions", icon: TagIcon, Page: TagList },
};
