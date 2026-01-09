// app/[locale]/mission/page.tsx
import { redirect } from "next/navigation";

export default function MissionIndex() {
  redirect("/mission/overview");
}
