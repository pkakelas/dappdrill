import { ConditionsPicture, ExploreAppPicture, TestPicture, WatchPicture, WritePicture } from "@/components/app-pictures";
import { Nav } from "@/components/nav";
import { Ci, Close, Findings, Hero, Why } from "@/components/sections";
import { Steps } from "@/components/steps";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Steps pictures={[<ExploreAppPicture key="explore" />, <WritePicture key="write" />, <TestPicture key="run" />, <ConditionsPicture key="break" />, <WatchPicture key="watch" />]} />
        <Ci />
        <Why />
        <Findings />
      </main>
      <Close />
    </>
  );
}
