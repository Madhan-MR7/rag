// MyWorkoutPlans.jsx — lists every saved 12-week plan for this user,
// shown separately from the chat so past plans stay easy to browse.
//
// Usage:
//   <MyWorkoutPlans
//     userId={auth.currentUser.uid}
//     backendUrl="http://localhost:8000"
//     onOpenPlan={(plan) => ...}   // called when the user clicks a plan card
//     onClose={() => ...}
//   />

import { useEffect, useState } from "react";

function formatDate(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function goalLabel(goal) {
  const map = {
    fat_loss: "Fat loss",
    muscle_gain: "Muscle gain",
    recomposition: "Recomposition",
  };
  return map[goal] || goal;
}

function MyWorkoutPlans({ userId, backendUrl = "http://localhost:8000", onOpenPlan, onClose, embedded = false }) {
  const [plans, setPlans]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [deletingId, setDeletingId] = useState(null);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${backendUrl}/workout-plans/${userId}`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setPlans(data);
    } catch (err) {
      console.error("Failed to load saved plans:", err);
      setError("Couldn't load your saved plans.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const handleDelete = async (planId, e) => {
    e.stopPropagation();
    setDeletingId(planId);
    try {
      await fetch(`${backendUrl}/workout-plan/${planId}`, { method: "DELETE" });
      setPlans((prev) => prev.filter((p) => p.id !== planId));
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={embedded ? styles.pageWrap : styles.overlay}>
      <style>{`
        .wp-plan-card:hover { border-color: #f59e0b99; background: #232f42; }
      `}</style>
      <div style={embedded ? styles.pageCard : styles.card}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Saved plans</div>
            <div style={styles.title}>My Workout Plans</div>
          </div>
          {onClose && (
            <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>

        <div style={styles.body}>
          {loading && <div style={styles.emptyState}>Loading…</div>}
          {!loading && error && <div style={styles.errorBox}>{error}</div>}

          {!loading && !error && plans.length === 0 && (
            <div style={styles.emptyState}>
              No saved plans yet. Generate one from the Workout Planner button and it'll
              show up here.
            </div>
          )}

          {!loading &&
            !error &&
            plans.map((plan) => (
              <div key={plan.id} className="wp-plan-card" style={styles.planCard} onClick={() => onOpenPlan?.(plan)}>
                <div style={styles.planCardMain}>
                  <div style={styles.planName}>{plan.profile?.name || "Untitled plan"}</div>
                  <div style={styles.planMeta}>
                    {formatDate(plan.createdAt)} · {goalLabel(plan.nutrition?.goal)} ·{" "}
                    {plan.profile?.days_per_week} days/week
                  </div>
                  <div style={styles.planMetaSub}>
                    {plan.nutrition?.calorie_target} kcal/day · {plan.phases?.length || 0} phases
                  </div>
                </div>
                <button
                  style={styles.deleteBtn}
                  onClick={(e) => handleDelete(plan.id, e)}
                  disabled={deletingId === plan.id}
                  title="Delete this plan"
                >
                  {deletingId === plan.id ? "…" : "🗑"}
                </button>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  pageWrap: {
    width: "100%",
    minHeight: "100%",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    padding: "40px 20px",
    boxSizing: "border-box",
  },
  pageCard: {
    width: "600px",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    color: "#e5e9f0",
    background: "#151b26",
    border: "1px solid #263041",
    borderRadius: "16px",
    boxShadow: "0 12px 40px rgba(0,0,0,0.28)",
  },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: "16px",
  },
  card: {
    width: "520px",
    maxWidth: "100%",
    maxHeight: "85vh",
    display: "flex",
    flexDirection: "column",
    background: "#151b26",
    border: "1px solid #263041",
    borderRadius: "16px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    color: "#e5e9f0",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "22px 24px 0 24px",
  },
  eyebrow: {
    fontSize: "11px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    opacity: 0.55,
    marginBottom: "4px",
  },
  title: { fontSize: "20px", fontWeight: 700 },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#9aa5b6",
    fontSize: "16px",
    cursor: "pointer",
    padding: "4px 8px",
  },
  body: { padding: "16px 24px 24px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px" },
  emptyState: { opacity: 0.6, fontSize: "13px", padding: "24px 4px", textAlign: "center", lineHeight: 1.5 },
  errorBox: {
    background: "#3b1414",
    border: "1px solid #7f1d1d",
    color: "#fca5a5",
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "13px",
  },
  planCard: {
    background: "#1f2937",
    border: "1px solid #2d3748",
    borderRadius: "10px",
    padding: "12px 14px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
    gap: "10px",
  },
  planCardMain: { display: "flex", flexDirection: "column", gap: "3px" },
  planName: { fontWeight: 700, fontSize: "14px" },
  planMeta: { fontSize: "12px", opacity: 0.7 },
  planMetaSub: { fontSize: "11px", opacity: 0.5 },
  deleteBtn: {
    background: "#2a1414",
    border: "1px solid #7f1d1d",
    color: "#fca5a5",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "12px",
    cursor: "pointer",
    flexShrink: 0,
  },
};

export default MyWorkoutPlans;
