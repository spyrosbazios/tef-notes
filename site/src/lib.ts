export const REPO = "https://github.com/spyrosbazios/tef-notes";
export const RELEASES = `${REPO}/releases/latest`;

export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
