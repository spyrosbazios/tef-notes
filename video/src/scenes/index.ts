// Every scene the storyboard can name. A scene is one file here, called after what it shows; it takes its shot (its words
// and its length) and draws one thing with the kit's moves over the site's screens.
import type { ComponentType } from "react";
import type { Shot } from "../storyboard";
import { Clip } from "./Clip";
import { Day } from "./Day";
import { Find } from "./Find";
import { Home } from "./Home";
import { Lens } from "./Lens";
import { NewTask } from "./NewTask";
import { Tasks } from "./Tasks";
import { Themes } from "./Themes";

export const SCENES = { Home, NewTask, Clip, Tasks, Day, Find, Lens, Themes } satisfies Record<string, ComponentType<{ shot: Shot }>>;

export type SceneName = keyof typeof SCENES;
