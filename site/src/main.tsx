import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The generated palette is imported here: Tailwind's CSS @import can't see Vite virtual modules.
import "virtual:tefnotes-theme.css";
import "./index.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
