// A note's address as it is handed out (Copy link, the phone's links, `noteHref`): the note opened over Home, the address
// replaced by the one the app keeps (`/?note=<id>`, routes/_app.tsx), so Back leaves rather than coming here again.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/note/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/", search: { note: params.id }, replace: true });
  },
});
