// crx3 ships no types; only the call scripts/crx.ts makes.
declare module "crx3" {
  export default function crx3(files: string[], options: { keyPath: string; crxPath: string }): Promise<unknown>;
}
