// The options page: the server's address, and Chrome's permission to reach that origin and no other.
import "virtual:tefnotes-theme.css";
import "./ui.css";
import { draw, icon, mark } from "./icons";
import { getServer, setServer, toOrigin } from "./settings";

const form = document.getElementById("form") as HTMLFormElement;
const input = document.getElementById("server") as HTMLInputElement;
const status = document.getElementById("status")!;
document.getElementById("brand")!.append(mark(20), "TEF Notes");

function show(kind: "done" | "fail", message: string) {
  status.hidden = false;
  status.className = `status ${kind}`;
  const text = document.createElement("div");
  text.textContent = message;
  status.replaceChildren(draw(icon[kind]), text);
}

void getServer().then((server) => { if (server) input.value = server; });

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const origin = toOrigin(input.value);
      // The permission prompt needs this submit's user gesture, so nothing is awaited before it.
      if (!(await setServer(origin))) return show("fail", "Access to the server was not granted.");
      input.value = origin;
      show("done", "Saved.");
    } catch (e) {
      show("fail", e instanceof Error ? e.message : "Something went wrong.");
    }
  })();
});
