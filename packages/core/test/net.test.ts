import { describe, expect, it } from "bun:test";
import { isPublicIp } from "../src/net";

describe("isPublicIp", () => {
  it("accepts public v4 and v6 addresses", () => {
    for (const ip of ["8.8.8.8", "142.250.74.14", "100.63.255.255", "100.128.0.1", "172.32.0.1", "2a00:1450:4001:81b::200e", "2606:4700::1111", "::ffff:8.8.8.8"])
      expect(isPublicIp(ip)).toBe(true);
  });
  it("refuses loopback, private, link-local, CGNAT/tailnet, documentation and reserved v4", () => {
    for (const ip of ["127.0.0.1", "0.0.0.0", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.86.234.101", "100.127.255.255", "192.0.2.1", "198.18.0.1", "224.0.0.1", "255.255.255.255"])
      expect(isPublicIp(ip)).toBe(false);
  });
  it("refuses loopback, ULA, link-local, 6to4, Teredo and mapped-private v6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "2002::1", "2001::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "fe80::1%eth0"])
      expect(isPublicIp(ip)).toBe(false);
  });
  it("refuses what is not an address", () => {
    for (const ip of ["", "localhost", "example.com", "1.2.3", "1.2.3.4.5", "256.1.1.1", "010.0.0.1", "0x7f.0.0.1", "2130706433", "1::2::3"])
      expect(isPublicIp(ip)).toBe(false);
  });
});
