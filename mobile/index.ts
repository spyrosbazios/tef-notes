// The app's entry: Expo Router's, and the home and lock screen widgets' task handler (src/widget/), which has to be
// registered here, where Android's headless start for a widget runs too.
import "expo-router/entry";
import { registerWidgets } from "@/widget/register";

registerWidgets();
