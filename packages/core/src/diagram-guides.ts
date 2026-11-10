// How to lay out each kind of diagram the agent draws: recipes the `diagram_guide` tool hands it before a `draw`
// (server/agent/src/drawings.ts), so the know-how costs nothing on a turn that never draws. Written in the `draw` tool's
// own terms: its shapes (`DRAW_KINDS`), colour names (`DRAW_COLORS`) and text sizes (`FONT_SIZES`), core/drawing.ts.

export const DIAGRAM_KINDS = ["flowchart", "architecture", "wireframe", "mindmap", "sequence", "timeline"] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];

/** For every kind: lay out on a grid, plan before drawing, check the picture each draw answers with. */
const COMMON = [
  "Plan first: list the boxes and what joins them, then place them on a grid before the first draw call.",
  "Keep to an 8 px grid: x, y, w and h multiples of 8. Same-role boxes share one size, and rows and columns line up.",
  "Leave 40 px or more between boxes so arrows and their labels have room; never let shapes overlap unless one holds the other.",
  "Size a box to its label: about 10 px a character at size m, plus 32 px; two short lines beat one long one. Labels of 1 to 4 words.",
  "Colour means something: two or three fills at most, the same fill for the same role, black strokes; say what a colour means in a legend if it isn't obvious.",
  "A title at the top left in size l, and nothing else bigger.",
  "Build it in a few calls: the boxes, then the arrows, then the titles and notes; check each picture and fix what is off.",
];

const KINDS: Record<DiagramKind, { use: string; steps: string[] }> = {
  flowchart: {
    use: "a process, a decision, how something works step by step",
    steps: [
      "Flow top to bottom (or left to right when it is wide and shallow); one main path in a straight line, branches to the side.",
      "Start and end: ellipses. Steps: rectangles 160x64. Decisions: diamonds 160x96 with a question ending in ?.",
      "Every arrow joins two shapes by from/to; a decision's arrows labelled yes / no.",
      "A loop back goes up the side, never across other boxes.",
      "Colours: steps blue, decisions yellow, start/end gray, a failure or stop red.",
    ],
  },
  architecture: {
    use: "systems, services, how parts of software or an organisation connect",
    steps: [
      "Layers in rows, top to bottom: people and clients, then the edge (proxy, API), then services, then data stores.",
      "A group (a host, a network, a team) is a large dashed gray rectangle drawn first, with a text label at its top left in size s; its boxes sit 24 px inside it.",
      "Services: rectangles 176x72; data stores: ellipses; external things: gray fill.",
      "Arrows run in the direction data or calls go, labelled with what travels (HTTP, SQL, events) when it isn't obvious; a dashed arrow for async or optional.",
      "Colours by role: clients violet, services blue, stores green, external gray, anything security-sensitive red.",
    ],
  },
  wireframe: {
    use: "an app or web screen, a layout to discuss",
    steps: [
      "Draw the frame first: a rectangle the device's size (phone 390x844, laptop 1440x900), black stroke, no fill; several screens side by side 80 px apart, each with a title above it.",
      "Inside, 16 px margins (24 on a laptop), and stack from the top: status/top bar 56 high, content, then the bottom bar or main action.",
      "Grayscale: content blocks gray fill, images as gray rectangles with a line corner to corner, text as real words, never lorem ipsum.",
      "One accent: blue fill only on the primary action; secondary buttons outlined.",
      "Real sizes: buttons 48 high, list rows 56 to 72, text s for body, m for headings.",
      "Notes about behaviour go outside the frame in orange text, with an arrow to what they describe.",
    ],
  },
  mindmap: {
    use: "turning notes or an idea into a visual map, brainstorming, a topic's parts",
    steps: [
      "The central idea in the middle: an ellipse 200x96, size l text, yellow fill.",
      "Main branches around it evenly, 240 px or more away, each a rectangle with its own fill colour; their sub-points further out in the same colour, no fill or a lighter role.",
      "Lines (arrows with no label) from parent to child; keep branches from crossing by putting each on its own side.",
      "Summarise: a few words per node, at most about 7 branches and 5 points each; leave the detail in the note.",
    ],
  },
  sequence: {
    use: "who talks to whom in what order: a request through services, a handshake, a conversation",
    steps: [
      "Participants across the top as rectangles 144x56, 200 px apart; a dashed gray line straight down from each (a line shape).",
      "Messages as horizontal arrows between those lines, 56 px apart going down, in time order, labelled with what is sent.",
      "Replies dashed. A note on a step: a yellow rectangle beside it.",
      "Colours: the user violet, your system blue, third parties gray.",
    ],
  },
  timeline: {
    use: "dates, a history, a plan's phases, a roadmap",
    steps: [
      "A horizontal line across, left to right in time; evenly spaced ticks unless real gaps matter.",
      "Each event: a small ellipse on the line and a rectangle above or below it (alternate to fit), date in bold first line, then a few words.",
      "Phases: wide rectangles along the line with a light fill each, labelled inside.",
      "Today, if it is on it: a red dashed vertical line labelled today.",
    ],
  },
};

/** The recipe for a kind, as the lines the agent reads. */
export const diagramGuide = (kind: DiagramKind) => ({ kind, use: KINDS[kind].use, steps: KINDS[kind].steps, always: COMMON });

/** One line per kind, what each is for: the tool's description lists them. */
export const diagramKindsText = () => DIAGRAM_KINDS.map((k) => `${k} (${KINDS[k].use})`).join("; ");
