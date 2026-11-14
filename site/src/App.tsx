import { Clipper } from "@/components/Clipper";
import { Closing } from "@/components/Closing";
import { Features } from "@/components/Features";
import { Fits } from "@/components/Fits";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Keys } from "@/components/Keys";
import { Nav } from "@/components/Nav";
import { Showcase } from "@/components/Showcase";
import { Themes } from "@/components/Themes";

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Features />
        <Showcase />
        <Clipper />
        <Keys />
        <Fits />
        <Themes />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
