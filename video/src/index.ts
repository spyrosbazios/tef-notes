import { cancelRender, continueRender, delayRender, registerRoot } from "remotion";
import "./film.css";
import { Root } from "./Root";

// No frame is drawn before every face look.css declares has loaded: one taken while a face is on its way would be set in
// the fallback, and a film is its frames.
const faces = delayRender("Loading the faces");
Promise.all([...document.fonts].map((face) => face.load())).then(() => continueRender(faces), cancelRender);

registerRoot(Root);
