// A stand-in for the embedding model (src/semantic.ts): a word's concept is one dimension, so tests can say which
// texts mean the same thing without loading the real model. Preloaded (bunfig.toml) so no test downloads it.
import { Semantic, useSemantic, type Embed } from "../src/semantic";

export const CONCEPTS: Record<string, number> = { car: 0, toyota: 0, "αυτοκίνητο": 0, dentist: 1, "οδοντίατρος": 1 };

export const fakeEmbed: Embed = async (texts) => texts.map((t) => {
  const v = new Float32Array(4);
  for (const w of t.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w in CONCEPTS) v[CONCEPTS[w]!] = 1;
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
});

useSemantic(new Semantic(fakeEmbed));
