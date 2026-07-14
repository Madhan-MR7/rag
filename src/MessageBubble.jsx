// MessageBubble.jsx — renders exercise data as real lists + clean image grid

function ListSection({ icon, label, items }) {
  const values = Array.isArray(items) ? items.filter(Boolean) : [];

  return (
    <div style={{ marginTop: "14px" }}>
      <div
        style={{
          fontWeight: 600,
          marginBottom: "6px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span>{icon}</span>
        <span>{label}</span>
      </div>

      {values.length > 0 ? (
        <ul
          style={{
            margin: 0,
            paddingLeft: "22px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
          }}
        >
          {values.map((item, i) => (
            <li key={i} style={{ lineHeight: 1.5 }}>
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ opacity: 0.7 }}>N/A</div>
      )}
    </div>
  );
}

function TextSection({ icon, label, value }) {
  return (
    <div style={{ marginTop: "14px" }}>
      <div
        style={{
          fontWeight: 600,
          marginBottom: "4px",
          display: "flex",
          alignItems: "center",
          gap: "6px",
        }}
      >
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div>{value || "N/A"}</div>
    </div>
  );
}

function ExerciseCard({ exercise, exerciseIndex }) {
  const ex = exercise || {};

  return (
    <div>
      {exerciseIndex !== null && exerciseIndex !== undefined && (
        <div
          style={{
            fontSize: "12px",
            letterSpacing: "0.05em",
            opacity: 0.6,
            marginBottom: "6px",
            textTransform: "uppercase",
          }}
        >
          Exercise {exerciseIndex + 1}
        </div>
      )}

      <div style={{ fontSize: "18px", fontWeight: 700 }}>
        🏋️ {ex.exercise_name || "Unknown exercise"}
      </div>

      <ListSection icon="🎯" label="Primary muscles" items={ex.primary_muscles} />
      <ListSection icon="💪" label="Secondary muscles" items={ex.secondary_muscles} />
      <TextSection icon="⚙️" label="Equipment" value={ex.equipment} />
      <TextSection icon="📈" label="Difficulty" value={ex.difficulty} />
      <ListSection icon="📝" label="How to do" items={ex.how_to_do} />
      <ListSection icon="💡" label="Tips" items={ex.tips} />
    </div>
  );
}

function MessageBubble({
  role,
  text,
  exercise,
  exerciseIndex,
  fileUrl,
  fileName,
  isFile,
  images = [],
}) {
  if (isFile) {
    return (
      <div className={`message ${role}`}>
        <a href={fileUrl} target="_blank" rel="noreferrer">
          {fileName}
        </a>
      </div>
    );
  }

  // Filter out broken images before render so the grid never has empty holes
  const validImages = images.filter(Boolean);

  return (
    <div className={`message ${role}`}>
      {exercise ? (
        <ExerciseCard exercise={exercise} exerciseIndex={exerciseIndex} />
      ) : (
        <div style={{ whiteSpace: "pre-wrap" }}>{text}</div>
      )}

      {validImages.length > 0 && (
        <div style={{ marginTop: "14px" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              gap: "10px",
            }}
          >
            {validImages.map((img, index) => (
              <div
                key={index}
                style={{
                  flex: "0 0 160px" /* fixed width, never grows or shrinks */,
                  height: "160px",
                  borderRadius: "10px",
                  overflow: "hidden",
                  backgroundColor: "#1f2937",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                }}
              >
                <img
                  src={img}
                  alt={`exercise-${index + 1}`}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover" /* always fills box, crops to fit */,
                    display: "block",
                  }}
                  onError={(e) => {
                    // Hide the whole card, not just the img,
                    // so no empty gap appears in the row
                    e.currentTarget.parentElement.style.display = "none";
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default MessageBubble;
