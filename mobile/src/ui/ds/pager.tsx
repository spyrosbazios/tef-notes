// Pages to swipe between: react-native-pager-view's native pager (Android's ViewPager2), as an animated component so its
// scroll position can feed shared values on the UI thread. `usePagerPosition(position)` is the `onPageScroll` handler that
// keeps `position` at the fractional page index (0, 0.4 on the way to 1, 1): what Tabs' underline and a collapsing header follow.
// A page's children must be plain Views with a key (the pager clones them); a composite component there gets a style it ignores.
import PagerView, { type PagerViewOnPageScrollEventData, type PagerViewProps } from "react-native-pager-view";
import Animated, { useEvent, type SharedValue } from "react-native-reanimated";

export const Pager = Animated.createAnimatedComponent(PagerView);
export type PagerRef = PagerView;

/** Reanimated hands a worklet the event's fields flat, with no `nativeEvent`; the prop is typed for a JS handler, hence the cast. */
export function usePagerPosition(position: SharedValue<number>) {
  const handler = useEvent((e: PagerViewOnPageScrollEventData & { eventName: string }) => {
    "worklet";
    if (e.eventName.endsWith("onPageScroll")) position.set(e.position + e.offset);
  }, ["onPageScroll"]);
  return handler as unknown as NonNullable<PagerViewProps["onPageScroll"]>;
}
