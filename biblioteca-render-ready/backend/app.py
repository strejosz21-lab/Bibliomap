# app.py
from flask import Flask, render_template, jsonify, send_from_directory
import pandas as pd
import re
import os
import logging

# --- Config ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "data", "Biblioteca MHC.xlsx")

# Flask por defecto busca en "templates" y "static"
app = Flask(__name__, template_folder="templates", static_folder="static")
app.logger.setLevel(logging.INFO)

# --- Utilities to parse Dewey-like numbers ---
def extract_first_dewey_token(s):
    if not isinstance(s, str):
        return None
    m = re.search(r'\d+(?:\.\d+)?', s)
    return m.group(0) if m else None

def dewey_to_float(tok):
    if not tok:
        return None
    try:
        return float(tok)
    except Exception:
        return None

def parse_range_cell(cell_text):
    raw = "" if pd.isna(cell_text) else str(cell_text).strip()
    if raw == "":
        return (None, None, raw)
    parts = re.split(r'\s*-\s*', raw)
    start_tok = extract_first_dewey_token(parts[0])
    end_tok = extract_first_dewey_token(parts[-1]) if len(parts) > 1 else None
    start = dewey_to_float(start_tok)
    end = dewey_to_float(end_tok) if end_tok else start
    if start is not None and end is not None and start > end:
        start, end = end, start
    return (start, end, raw)

# --- Load Excel ---
def load_mapping_from_excel(path=DATA_PATH):
    if not os.path.exists(path):
        app.logger.error(f"Excel not found at {path}")
        return {"error": "excel_not_found", "path": path}
    try:
        xl = pd.ExcelFile(path)
        sheet = xl.parse(xl.sheet_names[0])
    except Exception as e:
        app.logger.exception("Error reading Excel")
        return {"error": "excel_read_error", "details": str(e)}

    anaquel_cols = [c for c in sheet.columns if 'ANAQUEL' in str(c).upper() or 'ANAQUE' in str(c).upper()]
    if not anaquel_cols:
        anaquel_cols = list(sheet.columns[1:6])

    estante_col = sheet.columns[0]
    rows = []
    for idx, row in sheet.iterrows():
        estante_label_raw = row[estante_col]
        estante_num = None
        if isinstance(estante_label_raw, str):
            m = re.search(r'(\d+)', estante_label_raw)
            if m:
                estante_num = int(m.group(1))
        if estante_num is None:
            estante_num = int(idx) + 1

        for j, col in enumerate(anaquel_cols, start=1):
            cell = row[col] if col in row else ""
            start, end, raw = parse_range_cell(cell)
            rows.append({
                "estante": estante_num,
                "anaquel": j,
                "raw": raw,
                "start": start,
                "end": end
            })

    max_estante = max((r["estante"] for r in rows if r["estante"] is not None), default=0)
    total_anaqueles = max((r["anaquel"] for r in rows), default=0)
    return {"rows": rows, "max_estante": int(max_estante), "total_anaqueles": int(total_anaqueles)}

MAPPING_CACHE = load_mapping_from_excel(DATA_PATH)
app.logger.info("Mapping loaded: estantes=%s anaqueles=%s",
                MAPPING_CACHE.get("max_estante"),
                MAPPING_CACHE.get("total_anaqueles"))

# --- Routes ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/mapping.json")
def mapping_json():
    return jsonify(MAPPING_CACHE)

@app.route('/static/<path:p>')
def serve_static(p):
    return send_from_directory(app.static_folder, p)

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
