// The owner's preferences on the server (core/prefs.ts): one record, keyed `owner`, under the rev contract. The core's protocol
// (core/prefs-sync.ts) speaks it over the app's one record transport; the engine in hooks/prefs.ts calls it as its `PrefsRemote`.
import { prefsRemote } from "@/core/prefs-sync";
import { recordTransport } from "./records";

export const remote = prefsRemote(recordTransport);
