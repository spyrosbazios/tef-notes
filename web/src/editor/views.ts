// The two nodes the browser draws for us: a photo (shown through the page's resolver, kept as the file's path)
// and a task item (a live checkbox). Plain DOM, no framework.
import type { Node } from "prosemirror-model";
import type { EditorView, NodeView, ViewMutationRecord } from "prosemirror-view";

/** The URL to show for an image's `src`, or null when there is none (yet): a photo the server doesn't list. */
export type ResolveImage = (src: string) => string | null;

export class ImageView implements NodeView {
  dom = document.createElement("span");
  private img = document.createElement("img");

  constructor(private node: Node, private resolve: () => ResolveImage, readonly views: Set<ImageView>) {
    this.dom.className = "pm-image";
    this.dom.contentEditable = "false";
    this.img.draggable = false;
    this.img.decoding = "async";
    this.img.addEventListener("error", () => this.show(null));
    this.views.add(this);
    this.refresh();
  }

  /** Point the picture at what the resolver says now; the placeholder when it says nothing. */
  refresh() { this.show(this.resolve()(this.node.attrs.src)); }

  private show(url: string | null) {
    if (url) {
      this.img.src = url;
      this.img.dataset.src = this.node.attrs.src;        // what a click hands to the viewer: the file's own path, not the URL it is shown from
      this.img.alt = this.node.attrs.alt;
      this.img.title = this.node.attrs.title ?? "";
      this.dom.replaceChildren(this.img);
    } else {
      const gap = document.createElement("span");
      gap.className = "pm-image-missing";
      gap.setAttribute("role", "img");
      gap.setAttribute("aria-label", "Photo not available");
      gap.textContent = this.node.attrs.alt || "Photo";
      this.dom.replaceChildren(gap);
    }
  }

  update(node: Node) {
    if (node.type !== this.node.type) return false;
    const moved = node.attrs.src !== this.node.attrs.src;
    this.node = node;
    if (moved) this.refresh();
    return true;
  }

  destroy() { this.views.delete(this); }
}

/** A list item; a task one gets a checkbox in front, outside the editable content. */
export class ListItemView implements NodeView {
  dom: HTMLElement;
  contentDOM: HTMLElement;
  private box: HTMLInputElement | null = null;

  constructor(private node: Node, private view: EditorView, private getPos: () => number | undefined) {
    this.dom = document.createElement("li");
    if (node.attrs.checked == null) {
      this.contentDOM = this.dom;
      return;
    }
    this.dom.className = "task-list-item";
    this.box = document.createElement("input");
    this.box.type = "checkbox";
    this.box.contentEditable = "false";
    this.box.setAttribute("aria-label", "Done");
    this.box.checked = node.attrs.checked;
    this.box.addEventListener("change", () => this.toggle());
    this.contentDOM = document.createElement("div");
    this.contentDOM.className = "task-content";
    this.dom.append(this.box, this.contentDOM);
  }

  private toggle() {
    const at = this.getPos();
    if (at == null || !this.box) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(at, undefined, { ...this.node.attrs, checked: this.box.checked }));
  }

  update(node: Node) {
    if (node.type !== this.node.type || (node.attrs.checked == null) !== (this.node.attrs.checked == null)) return false;
    this.node = node;
    if (this.box) this.box.checked = node.attrs.checked;
    return true;
  }

  stopEvent(e: Event) { return e.target === this.box; }
  ignoreMutation(m: ViewMutationRecord) { return this.box !== null && !this.contentDOM.contains(m.target); }
}
