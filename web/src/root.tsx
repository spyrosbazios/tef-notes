import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AssistantProvider } from "@/components/assistant/provider";
import { Toaster } from "@/components/ui/sonner";
import { UpdateToast } from "@/components/update-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApplyAppearance, useAppearance } from "@/hooks/appearance";
import App from "./App";

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 2 },
  },
});

/** Paints the chosen look (and an active lens's colour) on the page; inside the query client, which the lenses need. */
function Look() {
  useApplyAppearance();
  return null;
}

/** The app's providers (the assistant's chat above everything the routes show); the toasts follow the chosen theme's scheme. */
export function Root() {
  const { scheme } = useAppearance();
  return (
    <QueryClientProvider client={qc}>
      <Look />
      <TooltipProvider delayDuration={400}>
        <AssistantProvider>
          <App />
        </AssistantProvider>
        <Toaster theme={scheme} position="bottom-right" />
        <UpdateToast />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
