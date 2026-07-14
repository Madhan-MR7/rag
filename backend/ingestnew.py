import os
import uuid
import fitz

from sentence_transformers import SentenceTransformer

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct
)

# ==========================================
# CONFIG
# ==========================================

PDF_PATH = "data/ExerciseBook.pdf"          # adjust if needed

COLLECTION_NAME = "exercise"

# ==========================================
# EMBEDDING MODEL
# ==========================================

print("Loading BGE-M3...")

embed_model = SentenceTransformer("BAAI/bge-m3")

VECTOR_SIZE = embed_model.get_sentence_embedding_dimension()

print(f"Embedding Dimension = {VECTOR_SIZE}")

# ==========================================
# QDRANT
# ==========================================

client = QdrantClient(host="localhost", port=6333)

if client.collection_exists(COLLECTION_NAME):
    client.delete_collection(COLLECTION_NAME)

client.create_collection(
    collection_name=COLLECTION_NAME,
    vectors_config=VectorParams(
        size=VECTOR_SIZE,
        distance=Distance.COSINE
    )
)

# ==========================================
# OPEN PDF
# ==========================================

if not os.path.exists(PDF_PATH):
    raise FileNotFoundError(
        f"PDF not found at '{PDF_PATH}'. "
        "Update PDF_PATH in the CONFIG section."
    )

pdf = fitz.open(PDF_PATH)
total_pages = len(pdf)
print(f"PDF loaded: {total_pages} pages")

# ==========================================
# HELPER  — detect exercise title page
# ==========================================
# FIX (was is_recipe_title): The old logic used isupper() which matched
# ALL-CAPS watermarks like "CONGRATULATIONS!" instead of real exercise
# titles. New logic: a title page has a short, non-sentence line that
# looks like a proper noun (Title Case or ALL CAPS), is not too long,
# and appears near the top of the page.  We also reject common false
# positives (page numbers, single words that are generic, etc.).

# Keywords that commonly appear in exercise titles — used as a loose
# signal when the line is otherwise ambiguous.
EXERCISE_KEYWORDS = {
    "press", "curl", "raise", "fly", "row", "pull", "push",
    "squat", "lunge", "extension", "flexion", "dip", "deadlift",
    "crunch", "plank", "thrust", "swing", "snatch", "clean",
    "bench", "incline", "decline", "overhead", "lateral", "front",
    "cable", "barbell", "dumbbell", "machine", "band", "bodyweight",
    "chest", "back", "shoulder", "bicep", "tricep", "leg", "glute",
    "hamstring", "quad", "calf", "core", "ab", "abs",
}

# Words that indicate it is NOT an exercise title
FALSE_POSITIVE_WORDS = {
    "congratulations", "welcome", "introduction", "contents",
    "foreword", "preface", "chapter", "section", "page",
    "copyright", "all rights reserved", "disclaimer",
    "www.", "http", "@",
}

def is_exercise_title(text: str) -> bool:
    """
    Return True if this line looks like an exercise title.
    Criteria:
      - 3–60 characters (not a single letter or a whole paragraph)
      - Not a false-positive (watermarks, headers, page numbers)
      - Is either Title Case or ALL CAPS
      - Contains at least one exercise keyword  OR  is 2+ Title-Case words
    """
    text = text.strip()

    # Length guard
    if len(text) < 3 or len(text) > 60:
        return False

    lower = text.lower()

    # Reject known false positives
    for fp in FALSE_POSITIVE_WORDS:
        if fp in lower:
            return False

    # Reject pure numbers / page numbers
    if text.replace(" ", "").replace(".", "").isdigit():
        return False

    words = text.split()

    # Check casing: ALL CAPS words or Title Case words
    upper_words = [w for w in words if w.replace("'", "").isupper() and len(w) > 1]
    title_words = [w for w in words if w and w[0].isupper()]

    is_all_caps  = len(upper_words) >= 1 and len(upper_words) == len(words)
    is_title_case = len(title_words) >= 2

    if not (is_all_caps or is_title_case):
        return False

    # Must contain an exercise keyword OR be a multi-word Title Case phrase
    has_keyword = any(kw in lower for kw in EXERCISE_KEYWORDS)
    multi_word  = len(words) >= 2

    return has_keyword or (is_title_case and multi_word)


# ==========================================
# FIND EXERCISES  — sliding window scan
# ==========================================
# FIX: Old code assumed title=page N, content=page N+1 and jumped +2
# pages each time, missing exercises.  New approach: scan every page,
# collect all pages that look like a title, then group content between
# consecutive titles.

title_pages: list[tuple[int, str]] = []   # (page_index, title_text)

for page_idx in range(total_pages):
    page_text = pdf[page_idx].get_text()
    lines = [x.strip() for x in page_text.split("\n") if x.strip()]

    if not lines:
        continue

    # Check the first 6 lines for a title
    for line in lines[:6]:
        if is_exercise_title(line):
            title_pages.append((page_idx, line))
            break   # only one title per page

print(f"Title pages found: {len(title_pages)}")
for idx, (p, t) in enumerate(title_pages):
    print(f"  [{idx}] page {p}: {t}")

# ==========================================
# BUILD EXERCISE RECORDS
# ==========================================
# Each exercise = its title page + all pages up to (but not including)
# the next title page.

exercises: list[dict] = []

for i, (page_idx, title) in enumerate(title_pages):

    # Content spans from this title page to one before the next title
    if i + 1 < len(title_pages):
        next_title_page = title_pages[i + 1][0]
    else:
        next_title_page = total_pages   # go to end of PDF

    # Gather text from all pages in this exercise's range
    full_text_parts = []
    for p in range(page_idx, next_title_page):
        full_text_parts.append(pdf[p].get_text())

    full_text = "\n\n".join(full_text_parts).strip()

    exercises.append({
        "title":      title,
        "start_page": page_idx,
        "full_text":  full_text,
    })

print(f"\nExercises built: {len(exercises)}")

# ==========================================
# INGEST INTO QDRANT
# ==========================================

points = []

for ex in exercises:

    full_text = ex["full_text"]

    if not full_text.strip():
        print(f"  [SKIP] '{ex['title']}' — empty text")
        continue

    embedding = embed_model.encode(
        full_text,
        normalize_embeddings=True
    )

    payload = {
        "exercises_name": ex["title"],
        "exercises_text": full_text,
    }

    points.append(
        PointStruct(
            id=str(uuid.uuid4()),
            vector=embedding.tolist(),
            payload=payload
        )
    )

    print(f"  Prepared: {ex['title']} (chars: {len(full_text)})")

# ==========================================
# UPSERT
# ==========================================

if points:
    client.upsert(
        collection_name=COLLECTION_NAME,
        points=points
    )
    print(f"\nInserted {len(points)} exercises into '{COLLECTION_NAME}'")
else:
    print("\nWARNING: No exercises were inserted! Check your PDF structure.")

print("Done")