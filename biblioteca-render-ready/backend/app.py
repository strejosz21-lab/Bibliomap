
import re
import sqlite3
import os
from flask import Flask, render_template, request, jsonify, redirect, url_for, flash
from pathlib import Path
from scripts.parse_excel import load_and_parse

# --- Rutas y archivos base ---
BASE = Path(__file__).resolve().parent
DATA = BASE / "data"
DB = BASE / "db" / "biblioteca.db"

# --- Configuración Flask ---
app = Flask(
    __name__,
    template_folder=str(BASE.parent / "templates"),
    static_folder=str(BASE.parent / "static")
)
app.secret_key = os.environ.get("FLASK_SECRET", "secret")

# --- Función para consultar la base de datos ---
def query(val):
    conn = sqlite3.connect(DB)
    c = conn.cursor()
    c.execute(
        "SELECT pasillo, lado, estanteria, anaquel, raw_text "
        "FROM locations "
        "WHERE rango_inicio <= ? AND rango_fin >= ? LIMIT 1",
        (val, val)
    )
    result = c.fetchone()
    conn.close()
    return result

# --- Rutas de Flask ---
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify({"ok": False, "error": "Vacio"})

    m = re.search(r'(\d{1,3}(?:\.\d+)?)', q)
    if m:
        val = float(m.group(1))
        r = query(val)
        if r:
            pas, l, est, ana, raw = r
            return jsonify({
                "ok": True,
                "type": "dewey",
                "pasillo": pas,
                "lado": l,
                "estanteria": est,
                "anaquel": ana,
                "raw": raw
            })
    return jsonify({"ok": False, "error": "No encontrado"})

@app.route("/admin", methods=["GET", "POST"])
def admin():
    if request.method == "POST":
        ef = request.files.get("excel_file")
        mf = request.files.get("mapping_file")
        if ef:
            ef.save(DATA / "Biblioteca MHC.xlsx")
        if mf:
            mf.save(DATA / "mapping.csv")
        try:
            load_and_parse()
            flash("Import ok", "success")
        except Exception as e:
            flash(f"Error: {e}", "danger")
        return redirect(url_for("admin"))

    return render_template(
        "admin.html",
        excel_exists=(DATA / "Biblioteca MHC.xlsx").exists(),
        mapping_exists=(DATA / "mapping.csv").exists()
    )

# --- Ejecutar localmente ---
if __name__ == "__main__":
    try:
        load_and_parse()
    except Exception as e:
        print("Parse warning:", e)
    app.run(host="0.0.0.0", debug=True)
