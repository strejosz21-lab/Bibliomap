
import re, sqlite3, pandas as pd
from pathlib import Path
BASE = Path(__file__).resolve().parents[1]
EXCEL = BASE/"data"/"Biblioteca MHC.xlsx"
DB = BASE/"db"/"biblioteca.db"
MAPPING = BASE/"data"/"mapping.csv"
def dewey_to_float(s):
    if not isinstance(s,str): return None
    m=re.search(r'(\d{1,3}(?:\.\d+)?)', s)
    return float(m.group(1)) if m else None
def parse_range(t):
    if not isinstance(t,str): return (None,None)
    parts=re.split(r'\s*-\s*', t.replace('\u2013','-').replace('\u2014','-'))
    return dewey_to_float(parts[0]) , (dewey_to_float(parts[1]) if len(parts)>1 else dewey_to_float(parts[0]))
def create_db():
    conn=sqlite3.connect(DB); c=conn.cursor()
    c.execute('CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY, excel_row INTEGER, pasillo INTEGER, lado TEXT, estanteria INTEGER, anaquel INTEGER, rango_inicio REAL, rango_fin REAL, raw_text TEXT)')
    conn.commit(); conn.close()
def load_and_parse():
    create_db()
    if not EXCEL.exists(): print("Excel no encontrado:",EXCEL); return
    df=pd.read_excel(EXCEL, sheet_name=0)
    ana_cols=[c for c in df.columns if "ANAQUEL" in str(c).upper()]
    if not ana_cols: ana_cols=list(df.columns[1:6])
    if not MAPPING.exists():
        rows=[]; idx=0
        for p in range(1,9):
            for side in ["L","R"]:
                for e in range(1,7):
                    if idx>=len(df): break
                    rows.append({"excel_row_index":idx,"pasillo":p,"lado":side,"estanteria":e}); idx+=1
                if idx>=len(df): break
            if idx>=len(df): break
        pd.DataFrame(rows).to_csv(MAPPING,index=False)
    mapping=pd.read_csv(MAPPING)
    conn=sqlite3.connect(DB); c=conn.cursor()
    c.execute("DELETE FROM locations")
    for excel_row_index,row in df.iterrows():
        m=mapping[mapping['excel_row_index']==excel_row_index]
        if m.empty: continue
        pasillo=int(m.iloc[0]['pasillo']); lado=m.iloc[0]['lado']; est=int(m.iloc[0]['estanteria'])
        for anaquel_idx,col in enumerate(ana_cols, start=1):
            cell=row.get(col,""); inicio,fin = parse_range(str(cell))
            if inicio is None: continue
            c.execute("INSERT INTO locations (excel_row,pasillo,lado,estanteria,anaquel,rango_inicio,rango_fin,raw_text) VALUES (?,?,?,?,?,?,?,?)",(excel_row_index,pasillo,lado,est,anaquel_idx,inicio,fin,str(cell)))
    conn.commit(); conn.close(); print("DB creada:",DB)
if __name__=="__main__": load_and_parse()
