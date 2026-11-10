# README artwork

`overview.png` pairs a frame from the web demo with an illustration of the installed
web app's Home on a phone, using the same sample notes and tasks. The phone is
illustrated, not a screenshot of a device. It is identified as an illustration in the
main README.

The colours come from `packages/core/src/theme.ts` (Rosé Pine, orange accent), the
fonts and notebook mark from `assets/`, and the icons from Lucide. The phone
layout follows `site/src/components/mock/PhoneHome.tsx` and `mock/parts.tsx`, which
draw the same screen: the mark and Search, the days strip, the task box, two columns
of note tiles and the floating tab bar.

To regenerate after installing the web and agent dependencies:

```sh
bun docs/assets/render.ts
```

`web-home.png` is the sample recording's web frame. Replace it with another frame
of the same 1024 × 720 size when refreshing the demo. It contains fictional content.
The note photos were downloaded for that demo from Unsplash.
