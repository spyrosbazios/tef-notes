import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./root";
// The default theme as --tf-* (vite-shared.ts reads packages/core/src/theme.ts): index.css maps every token onto it,
// and hooks/appearance.ts re-sets the variables to the theme and accent this browser chose
import "virtual:tefnotes-theme.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
