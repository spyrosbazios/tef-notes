// The marks of the services a key unlocks, each drawn in the current colour. Exa's is its published logo
// (exa.ai/images/logo/exa-logo-blue.svg, the E alone); TypeSafe's is traced from its favicon, as it publishes no
// vector of it; the providers' come from simple-icons (CC0). Where a provider has no icon there, its name is written.
import { siAnthropic, siDeepseek, siOllama, siQwen, type SimpleIcon } from "simple-icons";
import { cn } from "@/lib";

type P = { className?: string; title?: string };

export const ExaMark = ({ className, title = "Exa" }: P) => (
  <svg viewBox="0 0 107 129" className={cn("fill-current", className)} role="img" aria-label={title}><path fillRule="evenodd" d="M106.417 9.30741C106.417 9.57392 106.324 9.83227 106.155 10.0388L61.5395 64.5L106.155 118.96C106.324 119.166 106.417 119.425 106.417 119.691V127.843C106.417 128.482 105.897 129 105.255 129H1.16175C0.520132 129 0 128.482 0 127.843V1.15695C0 0.517982 0.520131 0 1.16174 0H105.255C105.897 0 106.417 0.517984 106.417 1.15695V9.30741ZM19.0364 116.382H87.6921L53.363 74.4795L19.0364 116.382ZM12.6699 104.192L40.1426 70.6585H12.6699V104.192ZM12.6699 58.0409H39.8964L12.6699 24.8064V58.0409ZM53.363 54.5193L87.6921 12.6176H19.0364L53.363 54.5193Z" /></svg>
);

export const TypeSafeMark = ({ className, title = "TypeSafe" }: P) => (
  <svg viewBox="93 46 214 308" className={cn("fill-current", className)} role="img" aria-label={title}><path fillRule="evenodd" d="M0.0 200.0L0.0 0.0L200.0 0.0L400.0 0.0L400.0 200.0L400.0 400.0L200.0 400.0L0.0 400.0L0.0 200.0ZM302.7 225.9L302.9 168.5L281.8 155.0C270.2 147.6 259.7 140.7 258.4 139.7L256.0 137.9L256.0 112.2L256.0 86.5L228.0 68.3L200.0 50.2L148.7 83.4L97.5 116.7L97.2 173.2L97.0 229.8L120.5 245.0L144.0 260.3L144.0 286.9L144.0 313.5L172.0 331.7L200.1 349.8L251.3 316.6L302.5 283.3L302.7 225.9ZM186.0 318.0C178.6 313.1 172.5 308.7 172.5 308.1C172.5 307.0 244.9 259.7 246.6 259.7C248.0 259.7 275.0 277.0 275.0 277.9C274.9 278.4 201.7 326.2 200.1 326.7C199.8 326.8 193.4 322.9 186.0 318.0ZM163.0 275.1L163.0 260.2L186.5 244.9L210.0 229.7L210.0 204.3L210.0 178.9L222.9 170.5C230.1 165.8 236.1 162.0 236.4 162.0C236.7 162.0 237.0 180.1 237.0 202.2L237.0 242.5L203.8 264.0C185.5 275.8 168.9 286.5 166.8 287.8L163.0 290.1L163.0 275.1ZM271.0 252.0C264.2 247.6 258.0 243.5 257.3 242.9C256.3 242.0 256.0 233.7 256.0 201.9C256.0 179.9 256.3 162.0 256.7 162.0C257.0 162.0 263.3 165.9 270.7 170.6L284.0 179.2L284.0 219.6C284.0 241.8 283.8 260.0 283.6 260.0C283.4 260.0 277.7 256.4 271.0 252.0ZM138.8 234.2C131.2 229.4 125.1 225.2 125.0 224.9C125.0 224.5 131.4 220.1 139.1 215.1C152.1 206.7 153.4 206.0 155.4 207.3C177.1 221.0 182.0 224.4 180.8 225.5C178.5 227.6 154.2 243.0 153.3 243.0C152.8 243.0 146.3 239.1 138.8 234.2ZM176.3 198.2L163.1 189.5L163.0 175.7C163.0 167.6 163.4 162.0 163.9 162.2C164.4 162.3 170.5 166.1 177.4 170.5L189.9 178.5L190.0 192.8C190.0 200.6 189.9 207.0 189.8 206.9C189.6 206.9 183.6 202.9 176.3 198.2ZM116.0 166.8L116.0 127.5L150.7 105.0C169.7 92.6 186.4 81.9 187.6 81.2L190.0 79.9L190.0 94.2L190.0 108.5L167.0 123.3L144.0 138.2L144.0 163.6L144.0 189.0L131.0 197.5C123.8 202.2 117.5 206.0 117.0 206.0C116.4 206.0 116.0 191.4 116.0 166.8ZM184.7 152.8L170.9 143.6L185.2 134.3C193.1 129.2 199.7 125.0 200.0 125.0C200.3 125.0 206.9 129.2 214.8 134.3L229.1 143.6L215.4 152.4C207.8 157.3 201.0 161.4 200.1 161.6C199.2 161.7 192.3 157.8 184.7 152.8ZM222.8 116.7L210.0 108.5L210.0 94.2C210.0 86.4 210.2 80.0 210.4 80.0C210.7 80.0 216.8 83.8 223.9 88.5L237.0 97.0L237.0 111.0C237.0 118.7 236.7 125.0 236.2 125.0C235.8 125.0 229.8 121.3 222.8 116.7Z" /></svg>
);

const SI = ({ icon, className }: { icon: SimpleIcon; className?: string }) => (
  <svg viewBox="0 0 24 24" className={cn("fill-current", className)} role="img" aria-label={icon.title}><path d={icon.path} /></svg>
);

/** The writing providers, in the server's order (server/pb_hooks/lib/llm.js PROVIDERS). */
export const PROVIDERS: [string, SimpleIcon | null][] = [
  ["DeepSeek", siDeepseek], ["Anthropic", siAnthropic], ["OpenAI", null], ["Grok", null], ["Qwen", siQwen], ["Z.ai", null], ["Ollama", siOllama],
];

export const ProviderMark = ({ icon, className }: { icon: SimpleIcon; className?: string }) => <SI icon={icon} className={className} />;
