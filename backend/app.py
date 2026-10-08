from __future__ import annotations

import json
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = BASE_DIR / "datavault.db"

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024
CORS(app)


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def initialize_database() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS analysis_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                rows INTEGER NOT NULL,
                columns INTEGER NOT NULL,
                missing INTEGER NOT NULL,
                analyzed_at TEXT NOT NULL,
                result_json TEXT NOT NULL
            )
            """
        )


def json_safe(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if hasattr(value, "item"):
        return json_safe(value.item())
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def serialize_describe(frame: pd.DataFrame) -> dict[str, dict[str, Any]]:
    description = frame.describe(include="all").transpose()
    return {
        str(index): {
            str(column): json_safe(value)
            for column, value in row.items()
        }
        for index, row in description.iterrows()
    }


@app.get("/")
def health_check() -> tuple[Any, int]:
    return jsonify(
        {
            "status": "ok",
            "service": "DataVault API",
            "message": "DataVault is ready to analyze your data.",
        }
    ), 200


@app.post("/api/analyze")
def analyze_file() -> tuple[Any, int]:
    uploaded_file = request.files.get("file")
    if uploaded_file is None or not uploaded_file.filename:
        return jsonify({"error": "Please upload a CSV file."}), 400

    filename = uploaded_file.filename
    if not filename.lower().endswith(".csv"):
        return jsonify({"error": "Only CSV files are supported."}), 400

    try:
        data = pd.read_csv(uploaded_file)
    except (pd.errors.EmptyDataError, pd.errors.ParserError, UnicodeDecodeError) as error:
        return jsonify({"error": f"Unable to read this CSV file: {error}"}), 400
    except Exception:
        app.logger.exception("Unexpected error while reading uploaded CSV")
        return jsonify({"error": "The uploaded file could not be read."}), 400

    analyzed_at = datetime.now(timezone.utc).isoformat()
    result = {
        "filename": filename,
        "shape": {"rows": int(data.shape[0]), "columns": int(data.shape[1])},
        "columns": [str(column) for column in data.columns],
        "missing": {
            str(column): int(count)
            for column, count in data.isna().sum().items()
        },
        "head": json_safe(data.head(5).to_dict(orient="records")),
        "describe": serialize_describe(data),
        "analyzed_at": analyzed_at,
    }
    result = json_safe(result)
    total_missing = sum(result["missing"].values())

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO analysis_history
                (filename, rows, columns, missing, analyzed_at, result_json)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                filename,
                result["shape"]["rows"],
                result["shape"]["columns"],
                total_missing,
                analyzed_at,
                json.dumps(result),
            ),
        )

    return jsonify(result), 200


@app.get("/api/history")
def get_history() -> tuple[Any, int]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, filename, rows, columns, missing, analyzed_at
            FROM analysis_history
            ORDER BY id DESC
            LIMIT 20
            """
        ).fetchall()
    return jsonify([dict(row) for row in rows]), 200


initialize_database()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)