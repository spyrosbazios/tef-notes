// The Web Locks API for the tests that load lib/sync.ts, which Bun lacks: one tab, so the first request for a name holds it for
// good and any later one waits forever. Import it before lib/sync.ts.
const held = new Set<string>();
Object.defineProperty(navigator, "locks", {
  configurable: true,
  value: {
    request: (name: string, _options: object, granted: (lock: { name: string }) => Promise<unknown>) => {
      if (held.has(name)) return new Promise(() => {});
      held.add(name);
      return Promise.resolve().then(() => granted({ name }));
    },
  },
});
