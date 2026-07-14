// WorkoutPlanDisplay.jsx — renders a saved plan object (from
// POST /generate-workout-plan or GET /workout-plan/{userId}) with actions
// to download it (JSON or print-to-PDF) or delete it from the account.
//
// Usage:
//   <WorkoutPlanDisplay
//     plan={plan}
//     backendUrl="http://localhost:8000"
//     onClose={() => ...}
//     onDeleted={() => ...}   // called after a successful delete
//   />

import { useState } from "react";
import ExerciseDetailModal from "./ExerciseDetailModal";

function NutritionCard({ nutrition, name }) {
  const items = [
    { label: "Calories / day", value: `${nutrition.calorie_target} kcal` },
    { label: "Protein", value: `${nutrition.protein_g} g` },
    { label: "Carbs", value: `${nutrition.carbs_g} g` },
    { label: "Fats", value: `${nutrition.fats_g} g` },
  ];

  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>🍽️ Nutrition targets{name ? ` — ${name}` : ""}</div>
      <div style={styles.nutritionGrid}>
        {items.map((it) => (
          <div key={it.label} style={styles.nutritionCell}>
            <div style={styles.nutritionValue}>{it.value}</div>
            <div style={styles.nutritionLabel}>{it.label}</div>
          </div>
        ))}
      </div>
      <div style={styles.smallMeta}>
        BMR {nutrition.bmr} kcal · TDEE {nutrition.tdee} kcal · goal: {nutrition.goal.replace("_", " ")}
      </div>
      <div style={styles.hint}>{nutrition.notes}</div>
    </div>
  );
}

function DayCard({ day, onExerciseClick }) {
  if (day.is_rest) {
    return (
      <div style={styles.restDay}>
        <div style={styles.dayName}>{day.day_name}</div>
        <div style={styles.restBadge}>Rest day</div>
      </div>
    );
  }

  return (
    <div style={styles.trainingDay}>
      <div style={styles.dayHeader}>
        <div style={styles.dayName}>{day.day_name}</div>
        {day.muscle_focus && <div style={styles.focusBadge}>{day.muscle_focus}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
        {(day.exercises || []).map((ex, i) => (
          <div
            key={i}
            style={styles.exerciseRow}
            className="exercise-row-clickable"
            onClick={() => onExerciseClick?.(ex)}
          >
            <div style={styles.exerciseName}>
              {ex.name} <span style={styles.expandHint}>ⓘ</span>
            </div>
            <div style={styles.exerciseMeta}>
              {ex.sets} sets × {ex.reps}
              {ex.rest_seconds ? ` · ${ex.rest_seconds}s rest` : ""}
            </div>
            {ex.notes && <div style={styles.exerciseNotes}>{ex.notes}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function PhaseView({ phase, onExerciseClick }) {
  const restCount = (phase.split || []).filter((d) => d.is_rest).length;
  const trainCount = (phase.split || []).length - restCount;

  return (
    <div>
      <div style={styles.phaseSummary}>
        <div style={styles.phaseFocus}>{phase.phase_focus}</div>
        <div style={styles.phaseMeta}>
          {trainCount} training days · {restCount} rest days
        </div>
      </div>

      <div style={styles.daysGrid}>
        {(phase.split || []).map((day, i) => (
          <DayCard key={i} day={day} onExerciseClick={onExerciseClick} />
        ))}
      </div>

      {phase.progression_notes && (
        <div style={styles.progressionNote}>
          <strong>Progression:</strong> {phase.progression_notes}
        </div>
      )}
    </div>
  );
}

function downloadPlanAsJson(plan) {
  const name = plan?.profile?.name || "workout";
  const dateStr = plan?.createdAt ? plan.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const filename = `${name.replace(/\s+/g, "_")}_12_week_plan_${dateStr}.json`;

  const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function WorkoutPlanDisplay({ plan, backendUrl = "http://localhost:8000", onClose, onDeleted, onNewPlan, embedded = false }) {
  const [activePhase, setActivePhase] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedExercise, setSelectedExercise] = useState(null);

  if (!plan) return null;

  const { profile = {}, nutrition, phases = [], injury_modifications, general_notes, id } = plan;

  const handleDelete = async () => {
    if (!id) {
      onDeleted?.();
      onClose?.();
      return;
    }
    setDeleting(true);
    try {
      await fetch(`${backendUrl}/workout-plan/${id}`, { method: "DELETE" });
      onDeleted?.();
      onClose?.();
    } catch (err) {
      console.error("Failed to delete plan:", err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={embedded ? styles.pageWrap : styles.overlay}>
      {/* Print CSS: on screen only the active phase shows; when printing,
          every phase renders (so the PDF/printout has the full 12 weeks)
          and screen-only controls (tabs, buttons) are hidden. */}
      <style>{`
        .phase-panel { display: none; }
        .phase-panel.active { display: block; }
        .exercise-row-clickable:hover { background: #232d3d; }
        .wp-tab:hover { border-color: #f59e0b99; }
        @media print {
          body * { visibility: hidden; }
          #workout-plan-printable, #workout-plan-printable * { visibility: visible; }
          #workout-plan-printable {
            position: absolute; left: 0; top: 0; width: 100%;
            background: #fff !important; color: #000 !important; box-shadow: none !important;
            max-height: none !important; border: none !important;
          }
          .no-print { display: none !important; }
          .phase-panel { display: block !important; page-break-after: always; }
        }
      `}</style>

      <div id="workout-plan-printable" style={embedded ? styles.pageCard : styles.card}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>12-week program</div>
            <div style={styles.title}>{profile.name ? `${profile.name}'s plan` : "Your plan"}</div>
          </div>
          <div className="no-print" style={styles.headerActions}>
            {onNewPlan && (
              <button style={styles.iconBtn} onClick={onNewPlan} title="Generate a new plan">
                + New plan
              </button>
            )}
            <button style={styles.iconBtn} onClick={() => downloadPlanAsJson(plan)} title="Download as JSON">
              ⬇ JSON
            </button>
            <button style={styles.iconBtn} onClick={() => window.print()} title="Print / Save as PDF">
              🖨 PDF
            </button>
            {!confirmDelete ? (
              <button style={styles.iconBtnDanger} onClick={() => setConfirmDelete(true)} title="Delete this plan">
                🗑
              </button>
            ) : (
              <div style={styles.confirmRow}>
                <span style={{ fontSize: "11px" }}>Delete?</span>
                <button style={styles.iconBtnDanger} onClick={handleDelete} disabled={deleting}>
                  {deleting ? "…" : "Yes"}
                </button>
                <button style={styles.iconBtn} onClick={() => setConfirmDelete(false)}>
                  No
                </button>
              </div>
            )}
            {onClose && (
              <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
                ✕
              </button>
            )}
          </div>
        </div>

        <div style={styles.body}>
          {nutrition && <NutritionCard nutrition={nutrition} />}

          {injury_modifications && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>🩹 Injury considerations</div>
              <div style={styles.bodyText}>{injury_modifications}</div>
            </div>
          )}

          <div style={styles.section}>
            <div style={styles.sectionTitle}>📅 Training phases</div>

            <div className="no-print" style={styles.tabRow}>
              {phases.map((phase, i) => (
                <button
                  key={i}
                  className="wp-tab"
                  onClick={() => setActivePhase(i)}
                  style={{
                    ...styles.tab,
                    ...(activePhase === i ? styles.tabActive : {}),
                  }}
                >
                  Phase {phase.phase_number || i + 1}
                  <div style={styles.tabWeeks}>Weeks {phase.weeks}</div>
                </button>
              ))}
            </div>

            {/* On screen: only the active phase (via .active). When printing,
                the CSS above forces every .phase-panel to display. */}
            {phases.map((phase, i) => (
              <div key={i} className={`phase-panel ${i === activePhase ? "active" : ""}`}>
                <PhaseView phase={phase} onExerciseClick={setSelectedExercise} />
              </div>
            ))}
          </div>

          {general_notes && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>📌 Notes</div>
              <div style={styles.bodyText}>{general_notes}</div>
            </div>
          )}
        </div>
      </div>

      {selectedExercise && (
        <ExerciseDetailModal
          exercise={selectedExercise}
          backendUrl={backendUrl}
          onClose={() => setSelectedExercise(null)}
        />
      )}
    </div>
  );
}

// System font stack shared by the whole card — matches what FormAnalyzer.jsx
// already uses ("inherit" there just picks up whatever the page's base font
// is; here we set it explicitly since this component previously set no
// font-family at all and was falling back to the browser default serif/sans,
// which is why the exercise list looked visually "off" from the rest of the app).
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

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
    width: "820px",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    color: "#e5e9f0",
    fontFamily: FONT_STACK,
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
    width: "760px",
    maxWidth: "100%",
    maxHeight: "90vh",
    display: "flex",
    flexDirection: "column",
    background: "#151b26",
    border: "1px solid #263041",
    borderRadius: "16px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    color: "#e5e9f0",
    fontFamily: FONT_STACK,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "22px 24px 0 24px",
    gap: "12px",
  },
  headerActions: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  eyebrow: {
    fontSize: "11px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    opacity: 0.55,
    marginBottom: "4px",
  },
  title: { fontSize: "20px", fontWeight: 700, letterSpacing: "-0.01em" },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#9aa5b6",
    fontSize: "16px",
    cursor: "pointer",
    padding: "4px 8px",
  },
  iconBtn: {
    background: "#1f2937",
    border: "1px solid #2d3748",
    color: "#e5e9f0",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "12px",
    cursor: "pointer",
  },
  iconBtnDanger: {
    background: "#2a1414",
    border: "1px solid #7f1d1d",
    color: "#fca5a5",
    borderRadius: "8px",
    padding: "6px 10px",
    fontSize: "12px",
    cursor: "pointer",
  },
  confirmRow: { display: "flex", alignItems: "center", gap: "6px" },
  body: { padding: "20px 24px 28px 24px", overflowY: "auto" },
  section: {
    background: "#1a2230",
    border: "1px solid #232d3d",
    borderRadius: "12px",
    padding: "16px 18px",
    marginBottom: "16px",
  },
  sectionTitle: { fontWeight: 700, marginBottom: "12px", fontSize: "14px", letterSpacing: "-0.005em" },
  // Used for injury_modifications and general_notes — plain server-provided
  // paragraphs that previously had zero styling and fell back to the
  // browser's default font-size/line-height, breaking the card's rhythm.
  bodyText: { fontSize: "13px", lineHeight: 1.6, color: "#c9d1e0" },
  nutritionGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "10px",
  },
  nutritionCell: {
    background: "#1f2937",
    borderRadius: "10px",
    padding: "12px 8px",
    textAlign: "center",
  },
  nutritionValue: { fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  nutritionLabel: { fontSize: "11px", opacity: 0.6, marginTop: "2px" },
  smallMeta: { fontSize: "12px", opacity: 0.7, marginTop: "10px", fontVariantNumeric: "tabular-nums" },
  hint: { fontSize: "11px", opacity: 0.5, marginTop: "6px", lineHeight: 1.4 },
  tabRow: { display: "flex", gap: "8px", marginBottom: "14px", flexWrap: "wrap" },
  tab: {
    background: "#1f2937",
    border: "1px solid #2d3748",
    borderRadius: "10px",
    color: "#e5e9f0",
    padding: "8px 14px",
    fontSize: "12px",
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "left",
  },
  tabActive: { border: "1px solid #f59e0b", background: "#2a2013", boxShadow: "inset 0 0 0 1px rgba(245,158,11,0.35)" },
  tabWeeks: { fontSize: "10px", opacity: 0.6, fontWeight: 400, marginTop: "2px" },
  phaseSummary: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "10px" },
  phaseFocus: { fontSize: "14px", fontWeight: 600 },
  phaseMeta: { fontSize: "12px", opacity: 0.6 },
  daysGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "10px",
  },
  restDay: {
    background: "#1f2937",
    border: "1px dashed #2d3748",
    borderRadius: "10px",
    padding: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    opacity: 0.75,
  },
  restBadge: {
    fontSize: "11px",
    fontWeight: 600,
    color: "#93c5fd",
    background: "#1e2b45",
    borderRadius: "6px",
    padding: "3px 8px",
    display: "inline-block",
    width: "fit-content",
  },
  trainingDay: {
    background: "#1f2937",
    border: "1px solid #2d3748",
    borderRadius: "10px",
    padding: "12px",
  },
  dayHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  dayName: { fontWeight: 700, fontSize: "13.5px", letterSpacing: "-0.005em" },
  focusBadge: {
    fontSize: "10px",
    fontWeight: 600,
    color: "#86efac",
    background: "#16241c",
    borderRadius: "6px",
    padding: "3px 8px",
  },
  exerciseRow: {
    borderTop: "1px solid #232d3d",
    paddingTop: "6px",
    cursor: "pointer",
    borderRadius: "6px",
    padding: "6px 4px",
    transition: "background 0.15s",
  },
  // Exercise name now clearly the heaviest element in the row (13px/600),
  // sets/reps a step down in weight+size, and the tip note smaller + lighter
  // still — before, name/meta/notes all sat within ~1px and ~100 weight of
  // each other, so the row read as one flat block of text instead of a clear
  // name -> stats -> tip hierarchy.
  exerciseName: { fontWeight: 600, fontSize: "13px", lineHeight: 1.35 },
  expandHint: { opacity: 0.4, fontSize: "11px", fontWeight: 400 },
  exerciseMeta: {
    opacity: 0.65,
    fontSize: "11.5px",
    fontWeight: 500,
    marginTop: "2px",
    fontVariantNumeric: "tabular-nums",
  },
  exerciseNotes: { opacity: 0.5, fontSize: "11px", fontStyle: "italic", marginTop: "3px", lineHeight: 1.4 },
  progressionNote: {
    marginTop: "14px",
    fontSize: "12px",
    background: "#1f2937",
    borderRadius: "8px",
    padding: "10px 12px",
    lineHeight: 1.5,
  },
};

export default WorkoutPlanDisplay;
