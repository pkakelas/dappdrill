import { BugsPicture, ConditionsPicture, ExploreAppPicture, TestPicture } from "@/components/app-pictures";
import { Nav } from "@/components/nav";
import { Ci, Close, Findings, Hero, Why } from "@/components/sections";
import { Steps } from "@/components/steps";

export default function Page() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Steps pictures={[<ExploreAppPicture key="explore" />, <TestPicture key="run" />, <ConditionsPicture key="break" />, <BugsPicture key="report" />]} />
        <Ci />
        <Why />
        <Findings />
      </main>
      <Close />
    </>
  );
}
