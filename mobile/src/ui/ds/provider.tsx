// What the design system needs above every screen: the gesture root, the keyboard controller (every
// KeyboardAvoidingView and useKeyboardState is inert without it), and the portal host
// dialogs and menus render into (last, so they draw over everything).
import { PortalHost } from "@rn-primitives/portal";
import type { ReactNode } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";

export function DesignSystemProvider({ children }: { children: ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        {children}
        <PortalHost />
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
