// Dragging a list row to a new place with the browser's own drag and drop: no dependency, mouse only (a drag is not
// started by touch). The hook holds which row is picked up and which side of which row it is over; the list says what a
// drop means. A row only takes a drop from its own `group` (a section of the list), so a drag never crosses one.
import { useState, type HTMLAttributes } from "react";

export type RowDrag = {
  /** Spread on the row's element. */
  props: HTMLAttributes<HTMLElement>;
  /** This row is the one picked up. */
  dragging: boolean;
  /** The drop would land on this side of this row. */
  mark: "before" | "after" | null;
};

type Held = { id: string; group: string };
type Over = { id: string; after: boolean };

/** `onMove(group, id, over, after)`: row `id` was dropped before (or `after`) the row `over`, both in `group`. */
export function useRowDrag(onMove: (group: string, id: string, over: string, after: boolean) => void): (group: string, id: string) => RowDrag {
  const [held, setHeld] = useState<Held | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const end = () => { setHeld(null); setOver(null); };

  return (group, id) => {
    const mine = held?.group === group;
    return {
      dragging: held?.id === id,
      mark: mine && over?.id === id ? (over.after ? "after" : "before") : null,
      props: {
        draggable: true,
        onDragStart: (e) => {
          if (e.target !== e.currentTarget) return;                     // something inside the row (a link, a selection) is being dragged
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", id);  // Firefox starts no drag without data
          setHeld({ id, group });
        },
        onDragOver: (e) => {
          if (!held || held.group !== group) return; // no preventDefault: this row is not a place to drop
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (held.id === id) { setOver(null); return; }
          const r = e.currentTarget.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
          setOver((o) => (o?.id === id && o.after === after ? o : { id, after }));
        },
        onDragLeave: (e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o?.id === id ? null : o));
        },
        onDrop: (e) => {
          if (!held || held.group !== group) return;
          e.preventDefault();
          if (over) onMove(group, held.id, over.id, over.after);
          end();
        },
        onDragEnd: end,
      },
    };
  };
}
