"""
FitGPT RAG Evaluator — powered by LangSmith
=============================================
Evaluates the FitGPT RAG pipeline against the BodyCraft Exercise Guide dataset.

SETUP:
  pip install langsmith httpx python-dotenv

.env file:
  LANGCHAIN_API_KEY=ls__your_key_here
  LANGCHAIN_PROJECT=fitgpt-rag-eval
  LANGCHAIN_TRACING_V2=true
  FITGPT_BACKEND=http://localhost:8000

RUN:
  python evaluator.py
"""

import os
import json
import time
import httpx

from dotenv import load_dotenv
from langsmith import Client
from langsmith.evaluation import evaluate
from langsmith.schemas import Run, Example

load_dotenv()

# =====================================================
# CONFIG
# =====================================================

LANGSMITH_API_KEY = os.getenv("LANGCHAIN_API_KEY")
FITGPT_BACKEND    = os.getenv("FITGPT_BACKEND", "http://localhost:8000")
DATASET_NAME      = "FitGPT-BodyCraft-Eval-v2"
PROJECT_NAME      = os.getenv("LANGCHAIN_PROJECT", "fitgpt-rag-eval")
DATASET_FILE      = "data/eval_dataset.json"

langsmith_client  = Client(api_key=LANGSMITH_API_KEY)

# =====================================================
# STEP 1 — UPLOAD DATASET TO LANGSMITH
# =====================================================

def create_or_get_dataset() -> str:
    """
    Upload eval_dataset.json to LangSmith as a Dataset.
    Returns the dataset ID. Reuses existing dataset if already uploaded.
    """
    with open(DATASET_FILE) as f:
        raw = json.load(f)

    samples = raw["samples"]

    # Check if dataset already exists
    existing = list(langsmith_client.list_datasets(dataset_name=DATASET_NAME))
    if existing:
        print(f"[Dataset] Reusing existing dataset: '{DATASET_NAME}' (id={existing[0].id})")
        return str(existing[0].id)

    # Create new dataset
    dataset = langsmith_client.create_dataset(
        dataset_name=DATASET_NAME,
        description=raw.get("description", ""),
    )
    print(f"[Dataset] Created: '{DATASET_NAME}' (id={dataset.id})")

    # Upload all 51 examples
    inputs = [
        {
            "query":       s["query"],
            "query_type":  s["query_type"],
            "muscle_group":s["muscle_group"],
            "sample_id":   s["id"],
        }
        for s in samples
    ]
    outputs = [
        {
            "expected_exercise":        s.get("expected_exercise"),
            "expected_primary_muscles": s.get("expected_primary_muscles", []),
            "expected_keywords":        s.get("expected_keywords_in_answer", []),
            "expected_min_results":     s.get("expected_min_results", 1),
            "muscle_group":             s.get("muscle_group"),
            "query_type":               s.get("query_type"),
        }
        for s in samples
    ]

    langsmith_client.create_examples(
        inputs=inputs,
        outputs=outputs,
        dataset_id=dataset.id,
    )
    print(f"[Dataset] Uploaded {len(samples)} examples.")
    return str(dataset.id)


# =====================================================
# STEP 2 — THE SYSTEM UNDER TEST
# =====================================================

def fitgpt_rag_system(inputs: dict) -> dict:
    """
    Calls the FitGPT FastAPI /chat endpoint.
    Normalises the response into a standard output dict for evaluators.
    """
    query = inputs["query"]

    try:
        resp = httpx.post(
            f"{FITGPT_BACKEND}/chat",
            json={"query": query},
            timeout=120.0,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        return {
            "error":          str(e),
            "exercises":      [],
            "exercise_names": [],
            "all_text":       f"ERROR: {e}",
            "num_results":    0,
            "raw":            {},
        }

    exercises = []

    # Handle multi-exercise response (list/multi-muscle queries)
    if "exercises" in data and isinstance(data["exercises"], list):
        exercises = [ex for ex in data["exercises"] if ex.get("exercise_name")]

    # Handle single-exercise response
    elif "exercise" in data and isinstance(data["exercise"], dict):
        ex = data["exercise"]
        if ex.get("exercise_name"):
            exercises = [ex]

    exercise_names = [ex.get("exercise_name", "") for ex in exercises]

    # Flatten all text content for keyword search
    all_parts = []
    for ex in exercises:
        all_parts.append(ex.get("exercise_name", ""))
        all_parts.extend(ex.get("primary_muscles", []))
        all_parts.extend(ex.get("secondary_muscles", []))
        all_parts.append(ex.get("equipment", ""))
        all_parts.extend(ex.get("how_to_do", []))
        all_parts.extend(ex.get("tips", []))
    all_parts.append(data.get("answer", ""))

    all_text = " ".join(all_parts).lower()

    return {
        "exercises":      exercises,
        "exercise_names": exercise_names,
        "all_text":       all_text,
        "num_results":    len(exercises),
        "raw":            data,
    }


# =====================================================
# STEP 3 — EVALUATORS  (5 metrics)
# =====================================================

def eval_retrieval_hit(run: Run, example: Example) -> dict:
    """
    METRIC: retrieval_hit
    Score 1 if the expected exercise name appears in the response.
    Skipped (None) for list/multi/negative queries.
    """
    expected    = (example.outputs or {}).get("expected_exercise")
    query_type  = (example.outputs or {}).get("query_type", "")

    # Skip for non-single queries
    if expected is None or query_type in ("list_query", "multi_muscle_query", "negative_test"):
        return {"key": "retrieval_hit", "score": None, "comment": "N/A for this query type"}

    output         = run.outputs or {}
    exercise_names = output.get("exercise_names", [])

    hit = any(
        expected.lower() in name.lower() or name.lower() in expected.lower()
        for name in exercise_names
    )

    return {
        "key":     "retrieval_hit",
        "score":   1 if hit else 0,
        "comment": f"Expected '{expected}', got {exercise_names}",
    }


def eval_keyword_coverage(run: Run, example: Example) -> dict:
    """
    METRIC: keyword_coverage
    % of expected keywords that appear in the full response text.
    """
    expected_keywords = (example.outputs or {}).get("expected_keywords", [])
    if not expected_keywords:
        return {"key": "keyword_coverage", "score": None, "comment": "No keywords defined"}

    all_text = (run.outputs or {}).get("all_text", "").lower()
    hits     = [kw for kw in expected_keywords if kw.lower() in all_text]
    score    = len(hits) / len(expected_keywords)

    return {
        "key":     "keyword_coverage",
        "score":   round(score, 3),
        "comment": f"Matched {len(hits)}/{len(expected_keywords)}: {hits}",
    }


def eval_multi_result_count(run: Run, example: Example) -> dict:
    """
    METRIC: multi_result_count
    For list/multi queries: did the system return enough exercises?
    Score is proportional: returned/expected (capped at 1.0).
    """
    expected_min = (example.outputs or {}).get("expected_min_results", 1)
    num_results  = (run.outputs or {}).get("num_results", 0)
    query_type   = (example.outputs or {}).get("query_type", "")

    if expected_min <= 1 or query_type not in ("list_query", "multi_muscle_query"):
        return {"key": "multi_result_count", "score": None, "comment": "N/A for single queries"}

    score = min(1.0, num_results / expected_min)

    return {
        "key":     "multi_result_count",
        "score":   round(score, 3),
        "comment": f"Got {num_results} results, needed {expected_min}",
    }


def eval_answer_not_empty(run: Run, example: Example) -> dict:
    """
    METRIC: answer_not_empty
    Sanity check: did the system return any exercise?
    Negative tests (muscle_group='none') are scored inversely — they SHOULD return 0.
    """
    muscle_group = (example.outputs or {}).get("muscle_group", "")
    num_results  = (run.outputs or {}).get("num_results", 0)

    if muscle_group == "none":
        score   = 1 if num_results == 0 else 0
        comment = f"Negative test: expected 0 results, got {num_results}"
    else:
        score   = 1 if num_results > 0 else 0
        comment = f"Got {num_results} exercise(s)"

    return {
        "key":     "answer_not_empty",
        "score":   score,
        "comment": comment,
    }


def eval_primary_muscle_mentioned(run: Run, example: Example) -> dict:
    """
    METRIC: primary_muscle_mentioned
    At least one expected primary muscle group should appear in the response.
    """
    expected_muscles = (example.outputs or {}).get("expected_primary_muscles", [])
    if not expected_muscles:
        return {"key": "primary_muscle_mentioned", "score": None, "comment": "No muscles defined for this query"}

    all_text = (run.outputs or {}).get("all_text", "").lower()
    hits     = [m for m in expected_muscles if m.lower() in all_text]
    score    = 1 if hits else 0

    return {
        "key":     "primary_muscle_mentioned",
        "score":   score,
        "comment": f"Found: {hits} out of expected: {expected_muscles}",
    }


# =====================================================
# STEP 4 — RUN EVALUATION
# =====================================================

def run_evaluation():
    print("\n" + "="*60)
    print("  FitGPT RAG Evaluator — BodyCraft Exercise Guide")
    print("="*60)
    print(f"  Backend : {FITGPT_BACKEND}")
    print(f"  Dataset : {DATASET_NAME}")
    print(f"  Project : {PROJECT_NAME}")
    print("="*60 + "\n")

    # Upload dataset
    dataset_id = create_or_get_dataset()

    print(f"\n[Eval] Running evaluation — max_concurrency=1 to avoid Gemini quota hits...")

    results = evaluate(
        fitgpt_rag_system,
        data=DATASET_NAME,
        evaluators=[
            eval_retrieval_hit,
            eval_keyword_coverage,
            eval_multi_result_count,
            eval_answer_not_empty,
            eval_primary_muscle_mentioned,
        ],
        experiment_prefix="fitgpt-bodycraft",
        metadata={
            "model":     "BGE-M3 + BGE-reranker-v2-m3 + Gemini-2.5-flash",
            "retriever": "Hybrid dense+keyword with cross-encoder reranking",
            "pdf":       "BodyCraft Exercise Guide (52 exercises)",
            "version":   "2.0",
        },
        max_concurrency=1,  # keep at 1 to respect Gemini free-tier rate limits
    )

    # ── Print terminal summary ────────────────────────────────────────────
    print("\n" + "="*60)
    print("  EVALUATION COMPLETE — SUMMARY")
    print("="*60)

    scores = {}
    for r in results:
        for fb in (r.get("feedback") or []):
            key   = fb.key
            score = fb.score
            if score is None:
                continue
            if key not in scores:
                scores[key] = []
            scores[key].append(score)

    print(f"\n{'Metric':<35} {'Avg':>8}  {'Min':>6}  {'Max':>6}  {'N':>4}")
    print("-"*62)
    for metric, vals in sorted(scores.items()):
        avg = sum(vals) / len(vals)
        mn  = min(vals)
        mx  = max(vals)
        n   = len(vals)
        print(f"{metric:<35} {avg:>8.3f}  {mn:>6.3f}  {mx:>6.3f}  {n:>4}")

    overall = sum(sum(v) for v in scores.values()) / sum(len(v) for v in scores.values())
    print(f"\n  Overall score: {overall:.3f} / 1.000")
    print(f"\n  View full results at: https://smith.langchain.com")
    print(f"  Project: {PROJECT_NAME}\n")


# =====================================================
# MAIN
# =====================================================

if __name__ == "__main__":
    if not LANGSMITH_API_KEY:
        raise ValueError(
            "\n❌ LANGCHAIN_API_KEY not set in .env\n"
            "   Get your key from: https://smith.langchain.com → Settings → API Keys\n"
        )

    # Quick backend health check
    try:
        r = httpx.get(f"{FITGPT_BACKEND}/", timeout=5.0)
        print(f"✅ Backend reachable: {r.json()}")
    except Exception as e:
        print(f"⚠️  Backend not reachable at {FITGPT_BACKEND}: {e}")
        print("   Make sure 'uvicorn app:app --reload' is running first.\n")
        exit(1)

    run_evaluation()