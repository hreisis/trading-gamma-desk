import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AiStudyPage() {
  redirect("/?panel=ai-study");
}
