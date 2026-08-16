"use client";

import ModuleGrid from "./ModuleGrid";
import { PANELS } from "./panel-map";

/** A GRADE COMPLETA — hoje é o modo `ALL`, dentro de uma área ou geral. */
export default function DashboardClient({ only }: { only?: readonly string[] } = {}) {
  return <ModuleGrid panels={PANELS} only={only} />;
}
