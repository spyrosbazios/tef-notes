// Talk: the spoken conversation with the assistant (components/talk/page.tsx). Its loader only asks whether the server has it.
import { createFileRoute } from "@tanstack/react-router";
import { TalkPage } from "@/components/talk/page";
import { talkStatusQuery } from "@/hooks/talk";

export const Route = createFileRoute("/_app/talk")({
  loader: ({ context }) => { void context.queryClient.prefetchQuery(talkStatusQuery); },
  component: TalkPage,
});
