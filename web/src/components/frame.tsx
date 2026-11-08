// The root route's component (routes/__root.tsx): the assistant's chat above everything the routes show (it reads where the app is
// and drives it, so it lives inside the router), the toasts, the update toast, and in development the router's devtools. The toasts
// follow the chosen theme's scheme, and on the phone sit at the top under the inset (the bottom is the tabs' and the keyboard's):
// `offset` is sonner's for a window over 600px, `mobileOffset` its own below, and the tabs show below `md` (768px), so both carry it.
import { Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { AssistantProvider } from "@/components/assistant/provider";
import { Toaster } from "@/components/ui/sonner";
import { UpdateToast } from "@/components/update-toast";
import { useAppearance } from "@/hooks/appearance";
import { useNarrow } from "@/hooks/media";

const Devtools = import.meta.env.DEV
  ? lazy(() => import("@tanstack/react-router-devtools").then((m) => ({ default: m.TanStackRouterDevtools })))
  : () => null;

export function Frame() {
  const { scheme } = useAppearance();
  const narrow = useNarrow();
  const clear = narrow ? { top: "calc(env(safe-area-inset-top) + 0.5rem)" } : undefined;
  return (
    <>
      <AssistantProvider>
        <Outlet />
      </AssistantProvider>
      <Toaster theme={scheme} position={narrow ? "top-center" : "bottom-right"} offset={clear} mobileOffset={clear} />
      <UpdateToast />
      <Suspense><Devtools /></Suspense>
    </>
  );
}
