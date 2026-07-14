// FormAnalyzer.jsx — collects name, height, weight, body-fat %, injuries,
// experience level (+ goal & training days, needed to compute real nutrition
// numbers) and calls the backend to generate a 12-week plan.
//
// Body fat % can be entered manually, estimated from tape measurements
// (U.S. Navy method), or estimated from BMI + age (Deurenberg formula) —
// for people who don't have a tape measure handy.
//
// GOAL SELECTION: fat loss and muscle gain are not mutually exclusive — many
// people want both (a slow recomp-style cut, or "lean bulk" framing), so the
// goal pills are multi-select. "Recomposition / general fitness" is treated
// as its own distinct choice (no strong preference either way) and is
// mutually exclusive with the other two: picking it clears fat_loss/
// muscle_gain, and picking either of those clears it.
//
// Usage:
//   <FormAnalyzer
//     userId={auth.currentUser.uid}
//     backendUrl="http://localhost:8000"
//     onPlanGenerated={(plan) => ...}
//     onClose={() => ...}
//   />

import { useState } from "react";

const STEPS = ["About you", "Body stats", "Injuries", "Review"];

const EXPERIENCE_OPTIONS = [
  { value: "beginner",     label: "Beginner",     hint: "< 6 months training" },
  { value: "intermediate", label: "Intermediate", hint: "6 months – 2 years" },
  { value: "advanced",     label: "Advanced",     hint: "2+ years, trains consistently" },
];

const GOAL_OPTIONS = [
  { value: "fat_loss",      label: "Fat loss" },
  { value: "muscle_gain",   label: "Muscle gain" },
  { value: "recomposition", label: "Recomposition / general fitness" },
];

const BODY_FAT_METHODS = [
  { value: "manual", label: "I know it",          hint: "Enter your number directly" },
  { value: "tape",    label: "Tape measurements",  hint: "Waist & neck (Navy method)" },
  { value: "bmi",     label: "Estimate from BMI",  hint: "No tape needed" },
];

const initialForm = {
  name: "",
  height_cm: "",
  weight_kg: "",
  body_fat_pct: "",
  body_fat_method: "manual",
  gender: "male",
  age: "",
  waist_cm: "",
  neck_cm: "",
  hip_cm: "",
  injuries: "",
  experience_level: "beginner",
  goals: ["recomposition"], // array now — see GOAL SELECTION note above
  days_per_week: 4,
};

// U.S. Navy circumference method — needs height, waist, neck (+ hip for women).
// All measurements in cm. Reasonably accurate (~within a few % for most people).
// Returns { value, reason } — value is null if the estimate couldn't be computed,
// in which case reason explains why (shown live in the UI).
function estimateBodyFatFromTape({ gender, height_cm, waist_cm, neck_cm, hip_cm }) {
  const h = parseFloat(height_cm);
  const w = parseFloat(waist_cm);
  const n = parseFloat(neck_cm);
  const hip = parseFloat(hip_cm);

  if (!h) return { value: null, reason: "Enter your height above first." };
  if (!w || !n) return { value: null, reason: null }; // still filling in, no error yet
  if (gender === "female" && !hip) return { value: null, reason: null };

  let bf;
  if (gender === "male") {
    if (w - n <= 0) {
      return { value: null, reason: "Waist should be larger than neck — double-check your measurements." };
    }
    if (w - n < 15) {
      return {
        value: null,
        reason: "Waist and neck are too close together for the formula to work — for most men waist is 25cm+ bigger than neck.",
      };
    }
    bf = 495 / (1.0324 - 0.19077 * Math.log10(w - n) + 0.15456 * Math.log10(h)) - 450;
  } else {
    const combined = w + hip - n;
    if (combined <= 0) {
      return { value: null, reason: "Waist + hip should be larger than neck — double-check your measurements." };
    }
    if (combined < 40) {
      return {
        value: null,
        reason: "These measurements are too close together for the formula to work — double-check waist, hip, and neck.",
      };
    }
    bf = 495 / (1.29579 - 0.35004 * Math.log10(combined) + 0.221 * Math.log10(h)) - 450;
  }

  if (!isFinite(bf) || bf <= 0 || bf > 70) {
    return { value: null, reason: "These measurements produced an unrealistic result — double-check them." };
  }
  return { value: Math.round(bf * 10) / 10, reason: null };
}

// Deurenberg formula — estimates body fat from BMI, age, and gender.
// Less precise than tape measurements, but only needs numbers most people
// already know (height, weight, age).
function estimateBodyFatFromBMI({ gender, height_cm, weight_kg, age }) {
  const h = parseFloat(height_cm);
  const w = parseFloat(weight_kg);
  const a = parseFloat(age);

  if (!h) return { value: null, reason: "Enter your height above first." };
  if (!w) return { value: null, reason: "Enter your weight above first." };
  if (!a) return { value: null, reason: null }; // still filling in, no error yet

  const heightM = h / 100;
  const bmi = w / (heightM * heightM);
  const sex = gender === "male" ? 1 : 0;
  const bf = 1.2 * bmi + 0.23 * a - 10.8 * sex - 5.4;

  if (!isFinite(bf) || bf <= 0 || bf > 70) {
    return { value: null, reason: "These numbers produced an unrealistic result — double-check height, weight, and age." };
  }
  return { value: Math.round(bf * 10) / 10, bmi: Math.round(bmi * 10) / 10, reason: null };
}

function FormAnalyzer({ userId, backendUrl = "http://localhost:8000", onPlanGenerated, onClose, embedded = false }) {
  const [step, setStep]         = useState(0);
  const [form, setForm]         = useState(initialForm);
  const [errors, setErrors]     = useState({});
  const [loading, setLoading]   = useState(false);
  const [loadError, setLoadError] = useState("");

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  // Toggle one goal pill. "recomposition" is mutually exclusive with the
  // other two — picking it clears everything else, and picking fat_loss or
  // muscle_gain clears recomposition. fat_loss and muscle_gain can coexist.
  // Never allow the array to end up empty — if the user deselects their
  // only remaining goal, fall back to recomposition rather than leaving
  // nothing selected.
  const toggleGoal = (value) => {
    setForm((prev) => {
      let goals;
      if (value === "recomposition") {
        goals = ["recomposition"];
      } else {
        const withoutRecomp = prev.goals.filter((g) => g !== "recomposition");
        if (withoutRecomp.includes(value)) {
          goals = withoutRecomp.filter((g) => g !== value);
          if (goals.length === 0) goals = ["recomposition"];
        } else {
          goals = [...withoutRecomp, value];
        }
      }
      return { ...prev, goals };
    });
    setErrors((prev) => ({ ...prev, goals: undefined }));
  };

  // Keep body_fat_pct in sync whenever the inputs feeding the active
  // estimation method change.
  const [estimateReason, setEstimateReason] = useState(null);

  const applyEstimate = (next) => {
    if (next.body_fat_method === "tape") {
      const { value, reason } = estimateBodyFatFromTape(next);
      next.body_fat_pct = value !== null ? String(value) : "";
      setEstimateReason(reason);
    } else if (next.body_fat_method === "bmi") {
      const { value, reason } = estimateBodyFatFromBMI(next);
      next.body_fat_pct = value !== null ? String(value) : "";
      setEstimateReason(reason);
    } else {
      setEstimateReason(null);
    }
    return next;
  };

  const updateAndEstimate = (key, value) => {
    setForm((prev) => applyEstimate({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined, body_fat_pct: undefined }));
  };

  const selectBodyFatMethod = (method) => {
    setForm((prev) => applyEstimate({ ...prev, body_fat_method: method }));
    setErrors((prev) => ({ ...prev, body_fat_pct: undefined }));
  };

  const validateStep = () => {
    const e = {};
    if (step === 0) {
      if (!form.name.trim()) e.name = "Enter a name.";
      if (!form.goals || form.goals.length === 0) e.goals = "Pick at least one goal.";
    }
    if (step === 1) {
      const h = parseFloat(form.height_cm);
      const w = parseFloat(form.weight_kg);
      if (!h || h < 100 || h > 250) e.height_cm = "Enter a height in cm (100-250).";
      if (!w || w < 30 || w > 300) e.weight_kg = "Enter a weight in kg (30-300).";

      if (form.body_fat_method === "tape") {
        if (!form.waist_cm) e.waist_cm = "Enter waist circumference.";
        if (!form.neck_cm) e.neck_cm = "Enter neck circumference.";
        if (form.gender === "female" && !form.hip_cm) e.hip_cm = "Enter hip circumference.";
        if (!e.waist_cm && !e.neck_cm && !e.hip_cm) {
          const f = parseFloat(form.body_fat_pct);
          if (!f || f < 3 || f > 60) e.body_fat_pct = "Check your measurements — the estimate looks off.";
        }
      } else if (form.body_fat_method === "bmi") {
        if (!form.age) e.age = "Enter your age.";
        if (!e.age) {
          const f = parseFloat(form.body_fat_pct);
          if (!f || f < 3 || f > 60) e.body_fat_pct = "Check your inputs — the estimate looks off.";
        }
      } else {
        const f = parseFloat(form.body_fat_pct);
        if (form.body_fat_pct === "" || f < 3 || f > 60) e.body_fat_pct = "Enter body fat % (3-60).";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const next = () => {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch(`${backendUrl}/generate-workout-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          name: form.name.trim(),
          height_cm: parseFloat(form.height_cm),
          weight_kg: parseFloat(form.weight_kg),
          body_fat_pct: parseFloat(form.body_fat_pct),
          body_fat_source: form.body_fat_method, // "manual" | "tape" | "bmi" — useful for the backend to know confidence level
          injuries: form.injuries.trim() || "None",
          experience_level: form.experience_level,
          // Sending both: `goals` (array) is the real multi-select value —
          // update the backend to read this. `goal` (comma-joined string) is
          // kept alongside it purely for backward compatibility with an
          // endpoint that still expects a single string field; drop it once
          // the backend is updated to read `goals`.
          goals: form.goals,
          goal: form.goals.join(","),
          days_per_week: parseInt(form.days_per_week, 10),
        }),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.detail || `Request failed (${res.status})`);
      }

      const plan = await res.json();
      onPlanGenerated?.(plan);
    } catch (err) {
      console.error("Workout plan generation failed:", err);
      setLoadError(err.message || "Something went wrong generating your plan.");
    } finally {
      setLoading(false);
    }
  };

  const goalLabels = form.goals
    .map((g) => GOAL_OPTIONS.find((o) => o.value === g)?.label)
    .filter(Boolean)
    .join(" + ");

  return (
    <div style={embedded ? styles.pageWrap : styles.overlay}>
      <style>{`
        .wp-input:focus { border-color: #f59e0b !important; box-shadow: 0 0 0 3px rgba(245,158,11,0.18); }
        .wp-pill:hover { border-color: #f59e0b99; }
        .wp-close:hover { color: #e5e9f0; }
      `}</style>
      <div style={embedded ? styles.pageCard : styles.card}>
        <div style={styles.header}>
          <div>
            <div style={styles.eyebrow}>Personalized workout generator</div>
            <div style={styles.title}>Build your 12-week plan</div>
          </div>
          {onClose && (
            <button className="wp-close" style={styles.closeBtn} onClick={onClose} aria-label="Close">
              ✕
            </button>
          )}
        </div>

        <div style={styles.stepper}>
          {STEPS.map((label, i) => (
            <div key={label} style={styles.stepperItem}>
              <div
                style={{
                  ...styles.stepDot,
                  ...(i === step ? styles.stepDotActive : {}),
                  ...(i < step ? styles.stepDotDone : {}),
                }}
              >
                {i < step ? "✓" : i + 1}
              </div>
              <span style={{ ...styles.stepLabel, opacity: i === step ? 1 : 0.55 }}>
                {label}
              </span>
            </div>
          ))}
        </div>

        <div style={styles.body}>
          {step === 0 && (
            <div style={styles.stepContent}>
              <Field label="Name" error={errors.name}>
                <input
                  className="wp-input"
                  style={styles.input}
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="e.g. Arjun"
                />
              </Field>

              <Field label="Training experience">
                <div style={styles.pillRow}>
                  {EXPERIENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="wp-pill"
                      style={{
                        ...styles.pill,
                        ...(form.experience_level === opt.value ? styles.pillActive : {}),
                      }}
                      onClick={() => update("experience_level", opt.value)}
                    >
                      <div style={{ fontWeight: 600 }}>{opt.label}</div>
                      <div style={{ fontSize: "11px", opacity: 0.7 }}>{opt.hint}</div>
                    </button>
                  ))}
                </div>
              </Field>

              <Field
                label="Primary goal(s)"
                error={errors.goals}
              >
                <div style={styles.pillRow}>
                  {GOAL_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="wp-pill"
                      aria-pressed={form.goals.includes(opt.value)}
                      style={{
                        ...styles.pill,
                        ...(form.goals.includes(opt.value) ? styles.pillActive : {}),
                      }}
                      onClick={() => toggleGoal(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div style={styles.hint}>
                  You can select both Fat loss and Muscle gain together (e.g. a slow recomposition-style approach).
                </div>
              </Field>

              <Field label={`Days per week you can train: ${form.days_per_week}`}>
                <input
                  type="range"
                  min={2}
                  max={6}
                  value={form.days_per_week}
                  onChange={(e) => update("days_per_week", e.target.value)}
                  style={{ width: "100%" }}
                />
              </Field>
            </div>
          )}

          {step === 1 && (
            <div style={styles.stepContent}>
              <div style={styles.gridTwo}>
                <Field label="Height (cm)" error={errors.height_cm}>
                  <input
                    className="wp-input"
                    style={styles.input}
                    type="number"
                    value={form.height_cm}
                    onChange={(e) => updateAndEstimate("height_cm", e.target.value)}
                    placeholder="175"
                  />
                </Field>
                <Field label="Weight (kg)" error={errors.weight_kg}>
                  <input
                    className="wp-input"
                    style={styles.input}
                    type="number"
                    value={form.weight_kg}
                    onChange={(e) => updateAndEstimate("weight_kg", e.target.value)}
                    placeholder="72"
                  />
                </Field>
              </div>

              <Field label="Body fat %">
                <div style={styles.pillRow}>
                  {BODY_FAT_METHODS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className="wp-pill"
                      style={{
                        ...styles.pill,
                        ...(form.body_fat_method === opt.value ? styles.pillActive : {}),
                      }}
                      onClick={() => selectBodyFatMethod(opt.value)}
                    >
                      <div style={{ fontWeight: 600 }}>{opt.label}</div>
                      <div style={{ fontSize: "11px", opacity: 0.7 }}>{opt.hint}</div>
                    </button>
                  ))}
                </div>
              </Field>

              {(form.body_fat_method === "tape" || form.body_fat_method === "bmi") && (
                <Field label="Gender (used for the estimate formula)">
                  <div style={styles.pillRow}>
                    <button
                      type="button"
                      className="wp-pill"
                      style={{ ...styles.pill, ...(form.gender === "male" ? styles.pillActive : {}) }}
                      onClick={() => updateAndEstimate("gender", "male")}
                    >
                      Male
                    </button>
                    <button
                      type="button"
                      className="wp-pill"
                      style={{ ...styles.pill, ...(form.gender === "female" ? styles.pillActive : {}) }}
                      onClick={() => updateAndEstimate("gender", "female")}
                    >
                      Female
                    </button>
                  </div>
                </Field>
              )}

              {form.body_fat_method === "tape" && (
                <>
                  <div style={styles.gridTwo}>
                    <Field label="Waist (cm)" error={errors.waist_cm}>
                      <input
                        className="wp-input"
                        style={styles.input}
                        type="number"
                        value={form.waist_cm}
                        onChange={(e) => updateAndEstimate("waist_cm", e.target.value)}
                        placeholder="e.g. 84"
                      />
                    </Field>
                    <Field label="Neck (cm)" error={errors.neck_cm}>
                      <input
                        className="wp-input"
                        style={styles.input}
                        type="number"
                        value={form.neck_cm}
                        onChange={(e) => updateAndEstimate("neck_cm", e.target.value)}
                        placeholder="e.g. 38"
                      />
                    </Field>
                  </div>
                  {form.gender === "female" && (
                    <Field label="Hip (cm)" error={errors.hip_cm}>
                      <input
                        className="wp-input"
                        style={styles.input}
                        type="number"
                        value={form.hip_cm}
                        onChange={(e) => updateAndEstimate("hip_cm", e.target.value)}
                        placeholder="e.g. 98"
                      />
                    </Field>
                  )}
                  <div style={styles.hint}>
                    Measure with a soft tape: waist at the navel, neck just below the larynx
                    {form.gender === "female" ? ", hip at the widest point." : "."} This is the
                    U.S. Navy method — accurate to within a few percent for most people.
                  </div>
                </>
              )}

              {form.body_fat_method === "bmi" && (
                <>
                  <Field label="Age" error={errors.age}>
                    <input
                      className="wp-input"
                      style={styles.input}
                      type="number"
                      value={form.age}
                      onChange={(e) => updateAndEstimate("age", e.target.value)}
                      placeholder="e.g. 29"
                    />
                  </Field>
                  <div style={styles.hint}>
                    Estimated from your BMI, age, and gender (Deurenberg formula). Less precise
                    than a tape measurement — it can be off for very muscular or very lean people
                    — but works with numbers most people already know.
                  </div>
                </>
              )}

              {(form.body_fat_method === "tape" || form.body_fat_method === "bmi") && (
                <Field label="Estimated body fat %" error={errors.body_fat_pct}>
                  <input
                    className="wp-input"
                    style={{ ...styles.input, opacity: 0.85 }}
                    value={form.body_fat_pct}
                    readOnly
                    placeholder="Fill in the fields above"
                  />
                  {estimateReason && !errors.body_fat_pct && (
                    <div style={{ ...styles.hint, color: "#f59e0b" }}>{estimateReason}</div>
                  )}
                </Field>
              )}

              {form.body_fat_method === "manual" && (
                <Field label="Body fat %" error={errors.body_fat_pct}>
                  <input
                    className="wp-input"
                    style={styles.input}
                    type="number"
                    value={form.body_fat_pct}
                    onChange={(e) => update("body_fat_pct", e.target.value)}
                    placeholder="e.g. 18"
                  />
                  <div style={styles.hint}>
                    Not sure? Use a caliper, smart scale, or switch to one of the estimate methods above.
                  </div>
                </Field>
              )}
            </div>
          )}

          {step === 2 && (
            <div style={styles.stepContent}>
              <Field label="Injuries or physical limitations">
                <textarea
                  className="wp-input"
                  style={{ ...styles.input, minHeight: "110px", resize: "vertical" }}
                  value={form.injuries}
                  onChange={(e) => update("injuries", e.target.value)}
                  placeholder="e.g. lower back pain, right shoulder impingement — or write 'None'"
                />
                <div style={styles.hint}>
                  Be specific. The planner will avoid or modify exercises that could aggravate these.
                </div>
              </Field>
            </div>
          )}

          {step === 3 && (
            <div style={styles.stepContent}>
              <div style={styles.reviewGrid}>
                <ReviewRow label="Name" value={form.name} />
                <ReviewRow label="Height" value={`${form.height_cm} cm`} />
                <ReviewRow label="Weight" value={`${form.weight_kg} kg`} />
                <ReviewRow
                  label="Body fat"
                  value={`${form.body_fat_pct}%${form.body_fat_method !== "manual" ? " (estimated)" : ""}`}
                />
                <ReviewRow
                  label="Experience"
                  value={EXPERIENCE_OPTIONS.find((o) => o.value === form.experience_level)?.label}
                />
                <ReviewRow label="Goal(s)" value={goalLabels} />
                <ReviewRow label="Days / week" value={form.days_per_week} />
                <ReviewRow label="Injuries" value={form.injuries.trim() || "None"} />
              </div>

              {loadError && <div style={styles.errorBox}>{loadError}</div>}
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button
            style={{ ...styles.navBtn, visibility: step === 0 ? "hidden" : "visible" }}
            onClick={back}
            disabled={loading}
          >
            Back
          </button>

          {step < STEPS.length - 1 ? (
            <button style={styles.primaryBtn} onClick={next}>
              Continue
            </button>
          ) : (
            <button style={styles.primaryBtn} onClick={submit} disabled={loading}>
              {loading ? "Generating your plan…" : "Generate 12-week plan"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, error, children }) {
  return (
    <div style={{ marginBottom: "18px" }}>
      <div style={styles.fieldLabel}>{label}</div>
      {children}
      {error && <div style={styles.fieldError}>{error}</div>}
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div style={styles.reviewRow}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
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
    width: "560px",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    color: "#e5e9f0",
    fontFamily: "inherit",
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
    width: "480px",
    maxWidth: "100%",
    maxHeight: "88vh",
    display: "flex",
    flexDirection: "column",
    background: "#151b26",
    border: "1px solid #263041",
    borderRadius: "16px",
    boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
    color: "#e5e9f0",
    fontFamily: "inherit",
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
  stepper: {
    display: "flex",
    justifyContent: "space-between",
    padding: "18px 24px 4px 24px",
    gap: "6px",
  },
  stepperItem: { display: "flex", flexDirection: "column", alignItems: "center", flex: 1, gap: "6px" },
  stepDot: {
    width: "26px",
    height: "26px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 700,
    background: "#1f2937",
    border: "1px solid #2d3748",
    color: "#9aa5b6",
  },
  stepDotActive: { background: "#f59e0b", borderColor: "#f59e0b", color: "#151b26" },
  stepDotDone:   { background: "#22c55e", borderColor: "#22c55e", color: "#fff" },
  stepLabel: { fontSize: "10px", textAlign: "center", lineHeight: 1.2 },
  body: {
    padding: "20px 24px",
    overflowY: "auto",
    flex: 1,
  },
  stepContent: {},
  fieldLabel: { fontSize: "13px", fontWeight: 600, marginBottom: "8px", opacity: 0.85 },
  input: {
    width: "100%",
    boxSizing: "border-box",
    background: "#1f2937",
    border: "1px solid #2d3748",
    borderRadius: "8px",
    color: "#e5e9f0",
    padding: "10px 12px",
    fontSize: "14px",
    outline: "none",
  },
  hint: { fontSize: "11px", opacity: 0.55, marginTop: "6px", lineHeight: 1.4 },
  fieldError: { fontSize: "12px", color: "#f87171", marginTop: "6px" },
  gridTwo: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" },
  pillRow: { display: "flex", flexWrap: "wrap", gap: "8px" },
  pill: {
    flex: "1 1 auto",
    minWidth: "110px",
    textAlign: "left",
    background: "#1f2937",
    border: "1px solid #2d3748",
    borderRadius: "10px",
    color: "#e5e9f0",
    padding: "10px 12px",
    fontSize: "13px",
    cursor: "pointer",
  },
  pillActive: { border: "1px solid #f59e0b", background: "#2a2013", boxShadow: "inset 0 0 0 1px rgba(245,158,11,0.35)" },
  reviewGrid: { display: "flex", flexDirection: "column", gap: "10px" },
  reviewRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: "12px",
    fontSize: "13px",
    borderBottom: "1px solid #202938",
    paddingBottom: "8px",
  },
  errorBox: {
    marginTop: "14px",
    background: "#3b1414",
    border: "1px solid #7f1d1d",
    color: "#fca5a5",
    borderRadius: "8px",
    padding: "10px 12px",
    fontSize: "13px",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "16px 24px 22px 24px",
    borderTop: "1px solid #202938",
  },
  navBtn: {
    background: "transparent",
    border: "1px solid #2d3748",
    color: "#e5e9f0",
    borderRadius: "8px",
    padding: "10px 18px",
    fontSize: "13px",
    cursor: "pointer",
  },
  primaryBtn: {
    background: "#f59e0b",
    border: "none",
    color: "#151b26",
    borderRadius: "8px",
    padding: "10px 22px",
    fontSize: "13px",
    fontWeight: 700,
    cursor: "pointer",
  },
};

export default FormAnalyzer;
