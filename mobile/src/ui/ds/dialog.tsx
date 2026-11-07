// Dialogs over a scrim, on @rn-primitives/dialog. `Dialog` is controlled (`open`, `onOpenChange`) and composed:
// Dialog.Content > Dialog.Title, Dialog.Description, the body, Dialog.Footer of Buttons; Dialog.Close closes when its
// child is pressed. `AlertDialog` is the ready-made question: title, words, Cancel and one action.
import * as Primitive from "@rn-primitives/dialog";
import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Pressable, View } from "react-native";
import { Button, type ButtonVariant } from "./button";
import { cn } from "./cn";
import { T } from "./text";

function Root({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return <Primitive.Root open={open} onOpenChange={onOpenChange}>{children}</Primitive.Root>;
}

/** The panel's entrance: a quick fade with a hint of scale (Material's dialog), no spring, no overshoot. React Native's
 *  Animated, as the Sheet: Reanimated's entering animations misbehave on this RN. */
function Appear({ children }: { children: ReactNode }) {
  const [t] = useState(() => new Animated.Value(0));
  useEffect(() => { Animated.timing(t, { toValue: 1, duration: 150, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  return <Animated.View className="w-full max-w-[420px]" style={{ opacity: t, transform: [{ scale }] }}>{children}</Animated.View>;
}

function Content({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="absolute inset-0 items-center justify-center bg-scrim px-6">
        <Appear>
          {/* A tap inside the panel isn't a tap on the scrim */}
          <Pressable>
            <Primitive.Content className={cn("gap-3 rounded-3xl bg-raised p-6", className)}>{children}</Primitive.Content>
          </Pressable>
        </Appear>
      </Primitive.Overlay>
    </Primitive.Portal>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <Primitive.Title asChild><T variant="title">{children}</T></Primitive.Title>;
}

function Description({ children }: { children: ReactNode }) {
  return <Primitive.Description asChild><T tone="dim" size={15} className="leading-[22px]">{children}</T></Primitive.Description>;
}

function Footer({ className, children }: { className?: string; children: ReactNode }) {
  return <View className={cn("mt-2 flex-row flex-wrap justify-end gap-2", className)}>{children}</View>;
}

function Close({ children }: { children: ReactNode }) {
  return <Primitive.Close asChild>{children}</Primitive.Close>;
}

export const Dialog = Object.assign(Root, { Content, Title, Description, Footer, Close });

export type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** The action's word ("Delete"); `destructive` paints it red. */
  action: string;
  onAction: () => void;
  destructive?: boolean;
  cancel?: string;
  busy?: boolean;
  children?: ReactNode;
};

export function AlertDialog({ open, onOpenChange, title, description, action, onAction, destructive, cancel = "Cancel", busy, children }: AlertDialogProps) {
  const variant: ButtonVariant = destructive ? "destructive" : "filled";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <Dialog.Content>
        <Dialog.Title>{title}</Dialog.Title>
        {description ? <Dialog.Description>{description}</Dialog.Description> : null}
        {children}
        <Dialog.Footer>
          <Dialog.Close><Button variant="ghost">{cancel}</Button></Dialog.Close>
          <Button variant={variant} loading={busy} onPress={onAction}>{action}</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog>
  );
}
