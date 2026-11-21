// A stand-in for the `chrome` global the extension's modules call: both storage areas in memory, the site permissions the
// owner has granted, and the page script's result. `installChrome` replaces it before each test, so no state carries over.
type Items = Record<string, unknown>;
type Origins = { origins: string[] };

export type FakeChrome = {
  sync: Map<string, unknown>;
  session: Map<string, unknown>;
  /** Origin patterns (`https://host/*`) Chrome has been allowed to reach. */
  granted: Set<string>;
  /** What the permission prompt answers; a granted request is remembered. */
  accepts: boolean;
  /** Every `permissions.request` made, in order. */
  requests: Origins[];
  /** The page script's return value; `null` makes `executeScript` fail, as it does on a page Chrome won't script. */
  grabbed: { selection: string; text: string; alt: string; caption: string } | null;
  /** The arguments of the last script injection. */
  injected?: { args: unknown[]; tabId: number };
};

export function installChrome(): FakeChrome {
  const fake: FakeChrome = { sync: new Map(), session: new Map(), granted: new Set(), accepts: true, requests: [], grabbed: null };
  const area = (items: Map<string, unknown>) => ({
    get: async (key: string): Promise<Items> => (items.has(key) ? { [key]: items.get(key) } : {}),
    set: async (values: Items) => { for (const [k, v] of Object.entries(values)) items.set(k, v); },
    remove: async (key: string) => { items.delete(key); },
  });
  Object.assign(globalThis, {
    chrome: {
      storage: { sync: area(fake.sync), session: area(fake.session) },
      permissions: {
        request: async (want: Origins) => {
          fake.requests.push(want);
          if (fake.accepts) for (const o of want.origins) fake.granted.add(o);
          return fake.accepts;
        },
        contains: async (want: Origins) => want.origins.every((o) => fake.granted.has(o)),
        remove: async (gone: Origins) => {
          for (const o of gone.origins) fake.granted.delete(o);
          return true;
        },
      },
      scripting: {
        executeScript: async (job: { target: { tabId: number }; args: unknown[] }) => {
          fake.injected = { args: job.args, tabId: job.target.tabId };
          if (!fake.grabbed) throw new Error("Cannot access contents of the page");
          return [{ result: fake.grabbed }];
        },
      },
    },
  });
  return fake;
}
