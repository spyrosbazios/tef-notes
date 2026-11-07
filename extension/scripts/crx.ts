// Self-hosting for Chrome's ExtensionInstallForcelist: pack dist/ into a signed CRX3 with its update manifest, and the
// extension ID the signing key gives. The key is your signing key (`server/crx-key.pem`, gitignored); nothing here ever prints it.
//
//   bun scripts/crx.ts id [key]           the extension ID (default key: server/crx-key.pem)
//   bun scripts/crx.ts pack <key> <out>   <out>/tefnotes.crx + <out>/update.xml; without a key, a note and nothing written
//
// pack needs TEF_NOTES_URL, the server's public origin, the same variable vite.config.ts puts in the manifest's update_url.
import crx3 from "crx3";
import { createHash, createPublicKey } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const die = (msg: string): never => { console.error(`crx: ${msg}`); process.exit(1); };

/** Chrome's ID: the SHA-256 of the public key (DER SubjectPublicKeyInfo), first 16 bytes, each nibble as a-p. */
function extensionId(keyPath: string): string {
  const der = createPublicKey(readFileSync(keyPath)).export({ type: "spki", format: "der" });
  const hex = createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...hex].map((h) => String.fromCharCode(97 + parseInt(h, 16))).join("");
}

async function pack(keyPath: string, out: string) {
  mkdirSync(out, { recursive: true });
  // crx3 would generate a key of its own when the path is missing: never let it get that far. Empty is the server
  // build's "no key yet" (its secret is the placeholder server/no-crx-key until server/.env names the key).
  if (!existsSync(keyPath) || statSync(keyPath).size === 0) {
    return console.error("crx: no signing key (server/crx-key.pem, gitignored), no CRX built");
  }
  const base = process.env.TEF_NOTES_URL || die("TEF_NOTES_URL is not set");
  const { version } = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8")) as { version: string };
  const id = extensionId(keyPath);
  await crx3([join(DIST, "manifest.json")], { keyPath, crxPath: join(out, "tefnotes.crx") });
  writeFileSync(join(out, "update.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${id}">
    <updatecheck codebase="${base}/extension/tefnotes.crx" version="${version}" />
  </app>
</gupdate>
`);
  console.error(`crx: tefnotes.crx ${version}, extension ID ${id}`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === "id") {
  const key = a ?? fileURLToPath(new URL("../../server/crx-key.pem", import.meta.url));
  if (!existsSync(key)) die(`no key at ${key} (your signing key, server/crx-key.pem, gitignored)`);
  console.log(extensionId(key));
} else if (cmd === "pack" && a && b) {
  await pack(a, b);
} else {
  die("usage: crx.ts id [key] | crx.ts pack <key> <out>");
}
