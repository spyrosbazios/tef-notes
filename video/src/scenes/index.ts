// Every scene the storyboard can name. A scene is one file here, called after what it shows; it takes its shot (its words
// and its length) and draws one thing with the kit's moves over the site's screens.
import type { ComponentType } from "react";
import type { Shot } from "../storyboard";
import { Ask } from "./Ask";
import { Clip } from "./Clip";
import { Home } from "./Home";
import { Lens } from "./Lens";
import { Tasks } from "./Tasks";
import { Themes } from "./Themes";

export const SCENES = { Home, Clip, Ask, Tasks, Lens, Themes } satisfies Record<string, ComponentType<{ shot: Shot }>>;

export type SceneName = keyof typeof SCENES;
