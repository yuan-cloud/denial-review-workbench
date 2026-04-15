import { useEffect, useState } from "react";
import { getCases, postRun } from "../api";

interface Props {
  onSelectCase: (caseId: string, runId: string) => void;
}

export default function CaseListPage({ onSelectCase }: Props) {
  const [cases, setCases] = useState<{ case_id: string }[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCases().then(setCases).catch((e) => setError(e.message));
  }, []);

  async function handleRun(caseId: string) {
    setLoading(caseId);
    setError(null);
    try {
      const run = await postRun(caseId);
      onSelectCase(caseId, run.run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  }

  return (
    <div style={{ maxWidth: 600, margin: "40px auto", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 24, marginBottom: 8 }}>Denial Review Workbench</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Select a case to review.</p>

      {error && (
        <div style={{ padding: 12, marginBottom: 16, background: "#fef2f2", color: "#b91c1c", borderRadius: 6 }}>
          {error}
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ textAlign: "left", padding: "8px 12px" }}>Case ID</th>
            <th style={{ textAlign: "right", padding: "8px 12px" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr key={c.case_id} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>{c.case_id}</td>
              <td style={{ padding: "10px 12px", textAlign: "right" }}>
                <button
                  onClick={() => handleRun(c.case_id)}
                  disabled={loading !== null}
                  style={{
                    padding: "6px 16px",
                    background: loading === c.case_id ? "#9ca3af" : "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 4,
                    cursor: loading !== null ? "not-allowed" : "pointer",
                  }}
                >
                  {loading === c.case_id ? "Analyzing..." : "Run Review"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {loading && (
        <p style={{ marginTop: 16, color: "#6b7280", textAlign: "center" }}>
          Analyzing case — this takes 10–20 seconds...
        </p>
      )}
    </div>
  );
}
