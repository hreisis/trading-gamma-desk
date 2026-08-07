import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function DemoAiStudyPage() {
  redirect("/demo?panel=ai-study");
}
