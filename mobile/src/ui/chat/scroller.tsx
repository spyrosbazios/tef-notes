// The transcript's scroll area. It keeps to the bottom while a reply streams in, lets go the moment the reader scrolls
// up, and shows a jump-to-bottom button until they are back. `useChatScroller().scrollToEnd` is for a control outside
// it (the keyboard opening). Remount it (`key`) for a different conversation: it opens at the end.
//
// Following: a line or two of growth (a streamed token) moves the view at once, a block (a new row, a card, a message)
// glides there. While a glide runs its own scroll events are not the reader leaving; a finger on the list always is.
import { ChevronDown } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { cn, IconButton } from "../ds";

const FAR = 64;                               // dp from the end beyond which the reader counts as having left it
const BLOCK = 48;                             // dp of growth at once that is a new block, not a streamed line
const GLIDE = 320;                            // ms a smooth scroll to the end is given before its events count again
type Ctx = { scrollToEnd: (animated?: boolean) => void };
const ScrollerContext = createContext<Ctx | null>(null);

export function useChatScroller() {
  const c = useContext(ScrollerContext);
  if (!c) throw new Error("useChatScroller must be used inside a <ChatScroller>");
  return c;
}

export function ChatScroller({ className, contentClassName, children }: { className?: string; contentClassName?: string; children: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  const following = useRef(true), gliding = useRef(false), touching = useRef(false), height = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [away, setAway] = useState(false);
  useEffect(() => () => clearTimeout(settle.current), []);
  const scrollToEnd = useCallback((animated = true) => {
    following.current = true;
    if (!animated) { ref.current?.scrollToEnd({ animated: false }); return; }
    gliding.current = true;
    clearTimeout(settle.current);
    settle.current = setTimeout(() => { gliding.current = false; if (following.current) setAway(false); }, GLIDE);
    ref.current?.scrollToEnd({ animated: true });
  }, []);
  const ctx = useMemo(() => ({ scrollToEnd }), [scrollToEnd]);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (gliding.current) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const far = contentSize.height - layoutMeasurement.height - contentOffset.y > FAR;
    following.current = !far;
    setAway(far);
  };
  const grew = (_w: number, h: number) => {
    const was = height.current;
    height.current = h;
    if (!following.current || touching.current) return;
    if (was > 0 && h - was > BLOCK) scrollToEnd(true); else ref.current?.scrollToEnd({ animated: false });   // opening at the end is no glide
  };
  return (
    <ScrollerContext.Provider value={ctx}>
      <View className={cn("relative overflow-hidden", className)}>
        <ScrollView ref={ref} accessibilityLabel="Messages" scrollEventThrottle={16} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          onScroll={onScroll} onContentSizeChange={grew}
          onScrollBeginDrag={() => { touching.current = true; gliding.current = false; }}
          onScrollEndDrag={() => { touching.current = false; }}
          contentContainerClassName={cn("px-4 pb-16", contentClassName)}>
          {children}
        </ScrollView>
        {away && (
          <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(120)} className="absolute bottom-4 self-center">
            <IconButton label="Jump to the latest" icon={ChevronDown} variant="tonal" compact className="border border-line" onPress={() => scrollToEnd(true)} />
          </Animated.View>
        )}
      </View>
    </ScrollerContext.Provider>
  );
}
