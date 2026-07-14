// WorkoutPlannerPage.jsx — the full "Workout Planner" main view. Swapped in
// place of the chat area when the user selects the "Workout Planner" tab
// in the topbar (instead of opening as a modal over the chat).
//
// Usage:
//   <WorkoutPlannerPage userId={auth.currentUser.uid} backendUrl={BACKEND} />

import { useEffect, useState } from "react";
import FormAnalyzer from "./FormAnalyzer";
import WorkoutPlanDisplay from "./WorkoutPlanDisplay";
import MyWorkoutPlans from "./MyWorkoutPlans";

// "form"  -> intake form (no plan yet, or generating a new one)
// "plan"  -> viewing a single plan (just generated, or opened from the list)
// "list"  -> browsing all saved plans
function WorkoutPlannerPage({ userId, backendUrl = "http://localhost:8000" }) {
  const [subView, setSubView] = useState("form");
  const [plan, setPlan] = useState(null);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // On first load, show the most recent saved plan if one exists,
  // otherwise start on the intake form.
  useEffect(() => {
    let cancelled = false;

    const loadLatest = async () => {
      try {
        const res = await fetch(`${backendUrl}/workout-plan/${userId}`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          setPlan(data);
          setSubView("plan");
        }
      } catch {
        // no saved plan yet — stay on the form, that's fine
      } finally {
        if (!cancelled) setLoadingInitial(false);
      }
    };

    loadLatest();
    return () => {
      cancelled = true;
    };
  }, [userId, backendUrl]);

  if (loadingInitial) {
    return (
      <div style={styles.pageWrap}>
        <div style={styles.loadingText}>Loading your workout planner…</div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.identityBar}>
        <span style={styles.identityIcon}>🏋️</span>
        <span style={styles.identityLabel}>Workout Planner</span>
      </div>

      <div style={styles.subNav}>
        <button
          style={{ ...styles.subNavBtn, ...(subView === "form" ? styles.subNavBtnActive : {}) }}
          onClick={() => setSubView("form")}
        >
          + New Plan
        </button>
        <button
          style={{
            ...styles.subNavBtn,
            ...(subView === "plan" && plan ? styles.subNavBtnActive : {}),
            ...(!plan ? { opacity: 0.4, cursor: "default" } : {}),
          }}
          onClick={() => plan && setSubView("plan")}
          disabled={!plan}
        >
          Current Plan
        </button>
        <button
          style={{ ...styles.subNavBtn, ...(subView === "list" ? styles.subNavBtnActive : {}) }}
          onClick={() => setSubView("list")}
        >
          My Plans
        </button>
      </div>

      <div style={styles.content}>
        {subView === "form" && (
          <FormAnalyzer
            embedded
            userId={userId}
            backendUrl={backendUrl}
            onClose={plan ? () => setSubView("plan") : undefined}
            onPlanGenerated={(newPlan) => {
              setPlan(newPlan);
              setSubView("plan");
            }}
          />
        )}

        {subView === "plan" && plan && (
          <WorkoutPlanDisplay
            embedded
            plan={plan}
            backendUrl={backendUrl}
            onNewPlan={() => setSubView("form")}
            onDeleted={() => {
              setPlan(null);
              setSubView("form");
            }}
          />
        )}

        {subView === "list" && (
          <MyWorkoutPlans
            embedded
            userId={userId}
            backendUrl={backendUrl}
            onOpenPlan={(selected) => {
              setPlan(selected);
              setSubView("plan");
            }}
          />
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    background: "#0b111d",
  },
  pageWrap: {
    width: "100%",
    minHeight: "100%",
    display: "flex",
    justifyContent: "center",
    padding: "32px 20px",
    boxSizing: "border-box",
  },
  pageCard: {
    width: "560px",   // match FormAnalyzer's card width so switching tabs doesn't jump
    maxWidth: "100%",
  },
  loadingText: { color: "#9aa5b6", fontSize: "14px" },
  identityBar: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "14px 20px 0 20px",
    flexShrink: 0,
  },
  identityIcon: { fontSize: "14px", lineHeight: 1 },
  identityLabel: {
    fontSize: "11px",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#f59e0b",
  },
  subNav: {
    display: "flex",
    gap: "4px",
    padding: "12px 16px 0 16px",
    borderBottom: "1px solid #202938",
    flexShrink: 0,
  },
  subNavBtn: {
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "#9aa5b6",
    borderRadius: "0",
    padding: "8px 12px 10px 12px",
    fontSize: "13px",
    fontWeight: 600,
    cursor: "pointer",
  },
  subNavBtnActive: {
    borderBottom: "2px solid #f59e0b",
    color: "#e5e9f0",
  },
  content: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    justifyContent: "center",   // horizontal centering
    // alignItems: "flex-start" // keep this if content should start at top and scroll
  },
};

export default WorkoutPlannerPage;
