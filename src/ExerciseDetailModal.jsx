// ExerciseDetailModal.jsx — shown when the user clicks an exercise inside
// a 12-week plan. Looks it up against the real exercise database
// (POST /exercise-detail) and shows verified how-to/tips/image if found;
// otherwise falls back to whatever the plan itself already had.
//
// Usage:
//   <ExerciseDetailModal
//     exercise={{ name, sets, reps, rest_seconds, notes }}  // from the plan
//     backendUrl="http://localhost:8000"
//     onClose={() => ...}
//   />

import { useEffect, useState } from "react";

function ListBlock({ icon, label, items }) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];
  if (values.length === 0) return null;
  return (
    <div style={{ marginTop: "14px" }}>
      <div style={styles.blockLabel}>
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <ul style={styles.list}>
        {values.map((item, i) => (
          <li key={i} style={{ lineHeight: 1.5 }}>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ExerciseDetailModal({ exercise, backendUrl = "http://localhost:8000", onClose }) {
  const [loading, setLoading]   = useState(true);
  const [found, setFound]       = useState(false);
  const [detail, setDetail]     = useState(null);
  const [error, setError]       = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`${backendUrl}/exercise-detail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exercise_name: exercise.name }),
        });
        const data = await res.json();
        if (cancelled) return;

        if (data.found) {
          setFound(true);
          setDetail(data.exercise);
        } else {
          setFound(false);
          if (data.error) setError(data.error);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Exercise detail lookup failed:", err);
          setError("Couldn't reach the server.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [exercise.name, backendUrl]);

  const image = found && detail?.image_urls?.[0] ? `${backendUrl}${detail.image_urls[0]}` : null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.title}>🏋️ {exercise.name}</div>
          <button style={styles.closeBtn} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={styles.body}>
          {/* Always show what the plan itself specified for this slot */}
          <div style={styles.planMeta}>
            {exercise.sets} sets × {exercise.reps}
            {exercise.rest_seconds ? ` · ${exercise.rest_seconds}s rest` : ""}
          </div>
          {exercise.notes && <div style={styles.planNotes}>{exercise.notes}</div>}

          {loading && <div style={styles.loading}>Looking up exercise details…</div>}

          {!loading && found && detail && (
            <>
              {image && (
                <div style={styles.imageWrap}>
                  <img src={image} alt={detail.exercise_name} style={styles.image} />
                </div>
              )}
              <ListBlock icon="🎯" label="Primary muscles" items={detail.primary_muscles} />
              <ListBlock icon="💪" label="Secondary muscles" items={detail.secondary_muscles} />
              <ListBlock icon="📝" label="How to do it" items={detail.how_to_do} />
              <ListBlock icon="💡" label="Tips" items={detail.tips} />
            </>
          )}

          {!loading && !found && (
            <div style={styles.fallbackNote}>
              {error
                ? `Couldn't fetch more detail (${error}). Showing what the plan already specified above.`
                : "This exercise isn't in our exercise database yet — showing what the plan already specified above."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1100,
    padding: "16px",
  },
  card: {
    width: "420px",
    maxWidth: "100%",
    maxHeight: "80vh",
    overflowY: "auto",
    background: "#151b26",
    border: "1px solid #263041",
    borderRadius: "16px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    color: "#e5e9f0",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "18px 20px",
    borderBottom: "1px solid #202938",
  },
  title: { fontSize: "16px", fontWeight: 700 },
  closeBtn: {
    background: "transparent",
    border: "none",
    color: "#9aa5b6",
    fontSize: "16px",
    cursor: "pointer",
    padding: "4px 8px",
  },
  body: { padding: "18px 20px 22px 20px" },
  planMeta: { fontSize: "13px", opacity: 0.75, fontWeight: 600 },
  planNotes: { fontSize: "12px", opacity: 0.55, fontStyle: "italic", marginTop: "4px" },
  loading: { fontSize: "12px", opacity: 0.6, marginTop: "16px" },
  imageWrap: {
    marginTop: "16px",
    borderRadius: "10px",
    overflow: "hidden",
    backgroundColor: "#1f2937",
    height: "180px",
  },
  image: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  blockLabel: { fontWeight: 600, marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px", fontSize: "13px" },
  list: { margin: 0, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px" },
  fallbackNote: {
    marginTop: "16px",
    fontSize: "12px",
    opacity: 0.6,
    lineHeight: 1.5,
    background: "#1f2937",
    borderRadius: "8px",
    padding: "10px 12px",
  },
};

export default ExerciseDetailModal;
