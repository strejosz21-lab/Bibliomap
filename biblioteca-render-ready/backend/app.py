# app.py
from flask import Flask, render_template, jsonify, send_from_directory, request
from pathlib import Path
import pandas as pd
import re, os, logging, csv

# --- Rutas base ---
BASE_DIR = Path(__file__).resolve().parent            # .../Bibliomap/backend
PROJECT_ROOT = BASE_DIR.parent                        # .../Bibliomap
DATA_DIR = BASE_DIR / "data"
EXCEL_PATH = DATA_DIR / "Biblioteca MHC.xlsx"
MAPCSV_PATH = DATA_DIR / "mapping.csv"

# Autodetecta dónde están templates/static (raíz o backend/)
CANDIDATE_TPL = [PROJECT_ROOT / "templates", BASE_DIR / "templates"]
CANDIDATE_STA = [PROJECT_ROOT / "static",    BASE_DIR / "static"]
TEMPLATES_DIR = next((p for p in CANDIDATE_TPL if p.exists()), CANDIDATE_TPL[0])
STATIC_DIR    = next((p for p in CANDIDATE_STA if p.exists()), CANDIDATE_STA[0])

app = Flask(__name__, template_folder=str(TEMPLATES_DIR), static_folder=str(STATIC_DIR))
app.logger.setLevel(logging.INFO)

# Logs de diagnóstico (útiles en Render)
app.logger.info("Templates dir: %s (exists=%s)", TEMPLATES_DIR, TEMPLATES_DIR.exists())
app.logger.info("Static dir: %s (exists=%s)", STATIC_DIR, STATIC_DIR.exists())

# Asegura /backend/data exista (no falla al escribir/leer)
DATA_DIR.mkdir(parents=True, exist_ok=True)

# --- Utils Dewey ---
NUM_RE = re.compile(r'\d+(?:[.,]\d+)?')
SEP_RE = re.compile(r'\s*(?:-|–|—|->|→|hasta|a)\s*', flags=re.IGNORECASE)

def extract_first_dewey_token(s):
    if s is None: return None
    s = str(s)
    m = NUM_RE.search(s)
    return m.group(0) if m else None

def to_float(tok):
    if tok is None: return None
    try:
        return float(str(tok).replace(',', '.'))
    except Exception:
        return None

def parse_range_cell(cell_text):
    raw = "" if (cell_text is None or (isinstance(cell_text, float) and pd.isna(cell_text))) else str(cell_text).strip()
    if raw == "":
        return (None, None, raw)
    parts = SEP_RE.split(raw)
    start_tok = extract_first_dewey_token(parts[0]) if parts else None
    end_tok   = extract_first_dewey_token(parts[-1]) if len(parts) > 1 else None
    start = to_float(start_tok)
    end   = to_float(end_tok) if end_tok else start
    if start is not None and end is not None and start > end:
        start, end = end, start
    return (start, end, raw)

# --- Carga mapping desde Excel (soporta formato "largo" y "ancho") ---
def load_locations_from_excel(path: Path):
    if not path.exists():
        return {"error":"excel_not_found", "path":str(path)}
    try:
        sheet = pd.ExcelFile(path).parse(0)
    except Exception as e:
        return {"error":"excel_read_error", "details":str(e)}

    # FIX: normaliza a str para evitar AttributeError con columnas no-string
    cols = {str(c).strip(): c for c in sheet.columns}

    def has(*names): return all(n in cols for n in names)

    rows = []

    if has("RangoInicio","RangoFin","Pasillo","Lado","Estantería","Anaquel"):
        # --- Formato LARGO (una fila por rango)
        for _, r in sheet.iterrows():
            start = to_float(r[cols["RangoInicio"]])
            end   = to_float(r[cols["RangoFin"]])
            pas   = str(r[cols["Pasillo"]]).strip() if not pd.isna(r[cols["Pasillo"]]) else ""
            lado  = str(r[cols["Lado"]]).strip() if not pd.isna(r[cols["Lado"]]) else "A"
            est   = int(r[cols["Estantería"]]) if not pd.isna(r[cols["Estantería"]]) else None
            ana   = int(r[cols["Anaquel"]]) if not pd.isna(r[cols["Anaquel"]]) else None
            raw   = str(r.get(cols.get("TextoOriginal",""), ""))
            if start is None or end is None or est is None or ana is None:
                continue
            rows.append({"pasillo":pas, "lado":lado or "A", "estanteria":est, "anaquel":ana,
                         "start":start, "end":end, "raw":raw})
    else:
        # --- Formato ANCHO (col 0 = estante; varias columnas "anaquel")
        estante_col = sheet.columns[0]
        anaquel_cols = [c for c in sheet.columns if 'ANAQUEL' in str(c).upper() or 'ANAQUE' in str(c).upper()]
        if not anaquel_cols:
            # fallback a las primeras 5 columnas después de la primera
            anaquel_cols = list(sheet.columns[1:6])

        for idx, r in sheet.iterrows():
            est_raw = r[estante_col]
            m = re.search(r'(\d+)', str(est_raw)) if isinstance(est_raw, str) else None
            est = int(m.group(1)) if m else int(idx)+1
            for j, col in enumerate(anaquel_cols, start=1):
                start, end, raw = parse_range_cell(r.get(col, ""))
                if start is None or end is None:
                    continue
                rows.append({"pasillo":"", "lado":"A", "estanteria":est, "anaquel":j,
                             "start":start, "end":end, "raw":raw})

    # índices útiles
    max_est = max((r["estanteria"] for r in rows), default=0)
    max_ana = max((r["anaquel"] for r in rows), default=0)
    return {"rows": rows, "max_estanteria": int(max_est), "max_anaquel": int(max_ana)}

def load_map_areas(csv_path: Path):
    """Lee mapping.csv con columnas: pasillo,lado,estanteria,anaquel,x0,y0,x1,y1"""
    if not csv_path.exists():
        return {}
    areas = {}
    with open(csv_path, newline='', encoding='utf-8') as f:
        rd = csv.DictReader(f)
        for r in rd:
            key = (str(r.get("pasillo","")).strip(),
                   str(r.get("lado","A")).strip(),
                   int(float(r.get("estanteria",0))),
                   int(float(r.get("anaquel",0))))
            try:
                bbox = {k: float(r[k]) for k in ("x0","y0","x1","y1")}
            except Exception:
                continue
            areas[key] = bbox
    return areas

LOC_CACHE = load_locations_from_excel(EXCEL_PATH)
AREA_CACHE = load_map_areas(MAPCSV_PATH)

app.logger.info("Excel: %s filas cargadas | map areas: %s",
                len(LOC_CACHE.get("rows", [])), len(AREA_CACHE))

# --- Helpers búsqueda ---
def parse_dewey_query(q):
    tok = extract_first_dewey_token(q)
    return to_float(tok)

def find_location(d):
    for r in LOC_CACHE.get("rows", []):
        if r["start"] is not None and r["end"] is not None and r["start"] <= d <= r["end"]:
            key = (str(r["pasillo"]).strip(), str(r["lado"]).strip() or "A", r["estanteria"], r["anaquel"])
            bbox = AREA_CACHE.get(key)
            return r, bbox
    return None, None

# --- Rutas ---
@app.get("/health")
def health():
    return "ok", 200

@app.route("/")
def index():
    # Si no existe la plantilla, evita 500 y da pista en logs
    idx = Path(app.template_folder) / "index.html"
    if not idx.exists():
        app.logger.error("index.html NO encontrado en %s", app.template_folder)
    return render_template("index.html")

@app.get("/mapping.json")
def mapping_json():
    return jsonify(LOC_CACHE)

@app.get("/api/search")
def api_search():
    q = request.args.get("dewey", "")
    d = parse_dewey_query(q)
    if d is None:
        return jsonify({"ok": False, "error": "Número Dewey inválido"}), 400
    r, bbox = find_location(d)
    if not r:
        return jsonify({"ok": True, "found": False})
    return jsonify({
        "ok": True, "found": True,
        "location": {
            "pasillo": r["pasillo"],
            "lado": r["lado"] or "A",
            "estanteria": r["estanteria"],
            "anaquel": r["anaquel"],
            "rango": [r["start"], r["end"]],
            "raw": r.get("raw","")
        },
        "bbox": bbox
    })

# Nota: Flask ya sirve /static. Esta ruta explícita es opcional.
@app.route('/static/<path:p>')
def serve_static(p):
    return send_from_directory(app.static_folder, p)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(debug=True, host="0.0.0.0", port=port)
