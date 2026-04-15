import { useState } from "react";
import CaseListPage from "./pages/CaseListPage";
import RunPage from "./pages/RunPage";

type View =
  | { page: "cases" }
  | { page: "run"; caseId: string; runId: string };

export default function App() {
  const [view, setView] = useState<View>({ page: "cases" });

  if (view.page === "cases") {
    return (
      <CaseListPage
        onSelectCase={(caseId: string, runId: string) =>
          setView({ page: "run", caseId, runId })
        }
      />
    );
  }

  return (
    <RunPage
      caseId={view.caseId}
      runId={view.runId}
      onBack={() => setView({ page: "cases" })}
    />
  );
}
