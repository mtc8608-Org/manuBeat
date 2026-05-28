"""
compute/routes.py — Python analytics engine for ManuSpine surveys.

What this module does (explicitly):
  1. Receives survey questions + raw answers from Node.js.
  2. Builds a pandas DataFrame — one row per submitted answer,
     one column per numeric question.
  3. Runs df.describe() to produce count / mean / std / min / percentiles / max.
  4. Applies IQR outlier detection (values below Q1-1.5*IQR or above Q3+1.5*IQR).
  5. Checks each numeric value against a hard-coded clinical reference range
     and counts how many readings fall outside it.
  6. /export: returns the raw DataFrame as a CSV download.

Node.js is responsible for fetching questions and answers from Postgres and
for persisting any results. Python owns all computation — it never touches the DB.
"""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Any
import pandas as pd
import io

router = APIRouter(prefix="/compute")

# ── Clinical reference ranges ─────────────────────────────────────────────────
# Keyed by the exact question text stored in survey_components.data->>'text'.
# (low, high) — values strictly outside this range are flagged as abnormal.
CLINICAL_RANGES: dict[str, tuple[float, float]] = {
    "SpO2 (%)":                       (95.0, 100.0),
    "Heart Rate (bpm)":               (60.0, 100.0),
    "Systolic BP (mmHg)":             (90.0, 140.0),
    "Diastolic BP (mmHg)":            (60.0,  90.0),
    "Temperature (°C)":               (36.1,  37.5),
    "Respiratory Rate (breaths/min)": (12.0,  20.0),
}


# ── Request model ─────────────────────────────────────────────────────────────

class Question(BaseModel):
    id: str
    type: str
    text: str


class SurveyStatsRequest(BaseModel):
    questions: list[Question]
    answers:   list[dict[str, Any]]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _numeric_df(questions: list[Question], answers: list[dict]) -> pd.DataFrame:
    """Build a DataFrame with one column per numeric question."""
    num_qs = [q for q in questions if q.type == "number"]
    rows = []
    for ans in answers:
        row: dict[str, float] = {}
        for q in num_qs:
            raw = ans.get(q.id)
            if raw is not None:
                try:
                    row[q.text] = float(raw)
                except (TypeError, ValueError):
                    pass
        rows.append(row)
    return pd.DataFrame(rows)


def _analyse_numeric(col_name: str, series: pd.Series) -> dict:
    """Run pandas describe + IQR outliers + clinical range check on one column."""
    s = series.dropna()
    if s.empty:
        return {"count": 0}

    desc = s.describe(percentiles=[0.25, 0.5, 0.75])

    # IQR outlier detection
    q1, q3 = s.quantile(0.25), s.quantile(0.75)
    iqr     = q3 - q1
    fence_lo, fence_hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    outliers = sorted(s[(s < fence_lo) | (s > fence_hi)].tolist())

    # Clinical range
    clinical = CLINICAL_RANGES.get(col_name)
    abnormal_count = 0
    if clinical:
        lo, hi = clinical
        abnormal_count = int(s[(s < lo) | (s > hi)].count())

    return {
        "count":          int(desc["count"]),
        "mean":           round(float(desc["mean"]), 2),
        "std":            round(float(desc["std"]),  2) if len(s) > 1 else 0.0,
        "min":            float(desc["min"]),
        "p25":            float(desc["25%"]),
        "p50":            float(desc["50%"]),
        "p75":            float(desc["75%"]),
        "max":            float(desc["max"]),
        "outliers":       outliers,
        "outlier_count":  len(outliers),
        "clinical_range": {"low": clinical[0], "high": clinical[1]} if clinical else None,
        "abnormal_count": abnormal_count,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/survey-stats")
def survey_stats(req: SurveyStatsRequest):
    """
    Main analytics endpoint.

    Returns per-question statistics. Numeric questions get the full
    pandas describe() output + outlier + clinical analysis.
    Categorical / text questions get value-frequency counts.
    """
    df = _numeric_df(req.questions, req.answers)

    columns = []

    for q in req.questions:
        if q.type == "number":
            stats = _analyse_numeric(q.text, df.get(q.text, pd.Series(dtype=float)))
            columns.append({"id": q.id, "question": q.text, "type": "number", **stats})

        elif q.type == "check":
            values      = [a[q.id] for a in req.answers if q.id in a]
            n           = len(values)
            true_count  = sum(1 for v in values if v is True or str(v).lower() == "true")
            false_count = n - true_count
            columns.append({
                "id": q.id, "question": q.text, "type": "check",
                "count":       n,
                "true_count":  true_count,
                "false_count": false_count,
                "true_pct":    round(true_count / n * 100, 1) if n else 0.0,
                "clinical_range": None, "abnormal_count": 0, "outliers": [],
            })

        elif q.type in ("select", "text", "textarea", "date"):
            values: list[str] = [
                str(a[q.id]) for a in req.answers
                if q.id in a and a[q.id] is not None
            ]
            counts: dict[str, int] = {}
            for v in values:
                counts[v] = counts.get(v, 0) + 1
            columns.append({
                "id": q.id, "question": q.text, "type": q.type,
                "count":  len(values),
                "unique": len(counts),
                "counts": dict(sorted(counts.items(), key=lambda x: -x[1])),
                "clinical_range": None, "abnormal_count": 0, "outliers": [],
            })

    return {
        "engine":          f"pandas {pd.__version__}",
        "total_responses": len(req.answers),
        "columns":         columns,
    }


@router.post("/survey-stats/export")
def export_csv(req: SurveyStatsRequest):
    """
    CSV export endpoint.

    Builds a flat DataFrame — one row per answer, one column per question —
    and returns it as a downloadable CSV file.
    pandas handles all type coercion and formatting.
    """
    col_names = [q.text for q in req.questions]
    id_to_text = {q.id: q.text for q in req.questions}

    rows = []
    for ans in req.answers:
        row = {id_to_text[qid]: val for qid, val in ans.items() if qid in id_to_text}
        rows.append(row)

    df = pd.DataFrame(rows, columns=col_names)

    buf = io.StringIO()
    df.to_csv(buf, index=False)
    buf.seek(0)

    return StreamingResponse(
        io.BytesIO(buf.read().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="survey_export.csv"'},
    )
