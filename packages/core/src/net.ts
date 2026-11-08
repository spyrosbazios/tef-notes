// Which IP addresses are the public internet. Pure, no I/O: the caller resolves a name and asks about every address it got.
// The same rules as server/pb_hooks/lib/link-preview.js `isPublicIp` (a PocketBase hook runs in its own VM and cannot import
// this; `core/test/net.test.ts` holds the cases both must agree on). Used by the agent before it posts to a push endpoint.

/** `a.b.c.d` as a 32-bit number; null unless it is four plain decimal octets (no leading zeros: some stacks read those as octal). */
function v4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const part = m[i]!;
    if (part.length > 1 && part.startsWith("0")) return null;
    const o = Number(part);
    if (o > 255) return null;
    n = n * 256 + o;
  }
  return n;
}

// [network, prefix length]: everything that is not the public internet (this host, private, CGNAT/tailnet, loopback,
// link-local, documentation, benchmarking, multicast, reserved)
const PRIVATE_V4: { net: number; bits: number }[] = ([
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const).map(([net, bits]) => ({ net: v4(net)!, bits }));

const publicV4 = (n: number) => !PRIVATE_V4.some(({ net, bits }) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(net / 2 ** (32 - bits)));

/** An IPv6 address as eight 16-bit groups; null when it is not one (zone ids included). */
function v6(input: string): number[] | null {
  let s = input;
  if (!s.includes(":") || !/^[0-9a-f:.]+$/i.test(s)) return null;
  const dot = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);        // ::ffff:1.2.3.4: the dotted tail is two groups
  if (dot) {
    const n = v4(dot[2]!);
    if (n === null) return null;
    s = `${dot[1]}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string) => (part === "" ? [] : part.split(":").map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN)));
  const head = parse(halves[0]!), rest = halves.length === 2 ? parse(halves[1]!) : [];
  const gap = 8 - head.length - rest.length;
  const all = halves.length === 2 ? (gap >= 1 ? [...head, ...new Array<number>(gap).fill(0), ...rest] : []) : head;
  return all.length === 8 && all.every((g) => Number.isInteger(g)) ? all : null;
}

function publicV6(g: number[]): boolean {
  const embedded = (a: number, b: number) => publicV4(g[a]! * 65536 + g[b]!);
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return embedded(6, 7);       // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return embedded(6, 7);   // NAT64
  if ((g[0]! & 0xe000) !== 0x2000) return false;                                           // only 2000::/3 is global unicast (no ::1, fe80::/10, fc00::/7 ULA)
  if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return false;                    // Teredo, documentation
  if (g[0] === 0x2002) return false;                                                       // 6to4
  return true;
}

/** Whether an address literal (v4 or v6) is on the public internet. False for anything that is not an address. */
export function isPublicIp(ip: string): boolean {
  const a = v4(ip);
  if (a !== null) return publicV4(a);
  const g = v6(ip);
  return g !== null && publicV6(g);
}
