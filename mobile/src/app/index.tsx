// The app opens at "/", and lands on the Home tab: there's no (tabs)/index to land on.
import { Redirect } from "expo-router";

export default function Index() {
  return <Redirect href="/home" />;
}
