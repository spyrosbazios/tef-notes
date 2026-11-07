// A month to pick one day from: arrows step months, today ringed, the picked day filled in the brand. Days are
// local Dates at midnight; `weekStartsOn` 0 is Sunday, 1 Monday.
import * as Haptics from "expo-haptics";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { IconButton } from "./button";
import { cn } from "./cn";
import { T } from "./text";

const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export type CalendarProps = { selected?: Date; onSelect: (d: Date) => void; defaultMonth?: Date; weekStartsOn?: number };

export function Calendar({ selected, onSelect, defaultMonth, weekStartsOn = 1 }: CalendarProps) {
  const [month, setMonth] = useState(() => { const d = defaultMonth ?? new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const today = new Date();
  const lead = (month.getDay() - weekStartsOn + 7) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1)),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const names = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + ((i + weekStartsOn) % 7)).toLocaleDateString(undefined, { weekday: "narrow" }));
  const step = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <View className="gap-1">
      <View className="flex-row items-center">
        <T variant="heading" className="flex-1 px-2">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</T>
        <IconButton label="Previous month" icon={ChevronLeft} onPress={() => step(-1)} />
        <IconButton label="Next month" icon={ChevronRight} onPress={() => step(1)} />
      </View>
      <View className="flex-row">
        {names.map((n, i) => <T key={i} variant="caption" font="semi" className="flex-1 text-center">{n}</T>)}
      </View>
      {weeks.map((w, i) => (
        <View key={i} className="flex-row">
          {w.map((d, j) => {
            if (!d) return <View key={j} className="h-11 flex-1" />;
            const on = !!selected && same(d, selected), now = same(d, today);
            return (
              <Pressable key={j} onPress={() => { void Haptics.selectionAsync(); onSelect(d); }} accessibilityRole="button"
                accessibilityLabel={d.toDateString()} accessibilityState={{ selected: on }} className="h-11 flex-1 items-center justify-center">
                <View className={cn("h-10 w-10 items-center justify-center rounded-full", on ? "bg-brand" : now && "border border-brand")}>
                  <T tone={on ? "bg" : now ? "brand" : "fg"} font={on || now ? "semi" : "num"} size={15}>{String(d.getDate())}</T>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
