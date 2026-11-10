// The phone's haptics: the Vibration API, so Android only (iOS Safari has none). One vocabulary, so a feel means one thing
// everywhere: `tap` a light step (tab switch), `tick` a crossed threshold or a done (tick, swipe, lift), `start` a recording begun,
// `success` a thing saved, `error` a write refused.
const PATTERN = { tap: 5, tick: 8, start: 15, success: [8, 40, 8], error: [20, 60, 20] } satisfies Record<string, VibratePattern>;

export type Haptic = keyof typeof PATTERN;

export const haptic = (kind: Haptic): void => { navigator.vibrate?.(PATTERN[kind]); };
