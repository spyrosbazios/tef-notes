// A text field that saves as it is typed, not per key: each save is a SQLite row and a store refresh. The text is the
// field's own while it is focused (a sync arriving meanwhile doesn't move it) and the stored value's otherwise; it goes
// 400 ms after the last key, on blur, on leaving the screen and on backgrounding, so the last words are never lost.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

export function useDraft(value: string, save: (text: string) => void, ms = 400) {
  const [text, setText] = useState(value);
  const focused = useRef(false), pending = useRef<string | null>(null), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saver = useRef(save);
  useEffect(() => { saver.current = save; });
  useEffect(() => { if (!focused.current) setText(value); }, [value]);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const p = pending.current;
    pending.current = null;
    if (p != null) saver.current(p);
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") flush(); });
    return () => { sub.remove(); flush(); };
  }, [flush]);

  return {
    value: text,
    onChangeText: (v: string) => { setText(v); pending.current = v; clearTimeout(timer.current); timer.current = setTimeout(flush, ms); },
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; flush(); },
  };
}
