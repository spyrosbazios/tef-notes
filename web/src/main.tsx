import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { splashUntilRendered } from "@/lib/splash";
import { Root } from "./root";
import { router } from "./router";
// The default theme as --tf-* (vite-shared.ts reads packages/core/src/theme.ts): index.css maps every token onto it,
// and hooks/appearance.ts re-sets the variables to the theme and accent this browser chose
import "virtual:tefnotes-theme.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
// The boot splash index.html opened with (vite-boot.ts) leaves once the first screen is on
splashUntilRendered(router);
