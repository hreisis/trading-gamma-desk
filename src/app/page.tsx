import { MacroDesk } from "@/app/components/MacroDesk";
import { loadMacroDesk } from "@/desk";

/** Always read local artifacts at request time when present. */
export const dynamic = "force-dynamic";

export default function Home() {
  const payload = loadMacroDesk();

  return (
    <MacroDesk
      driver={payload.driver}
      source={payload.source}
      snapshotPresent={payload.snapshotPresent}
    />
  );
}
