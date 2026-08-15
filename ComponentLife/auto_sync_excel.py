import zipfile
import xml.etree.ElementTree as ET
import re
import sys
import json
import os
from datetime import datetime, timedelta

sys.stdout.reconfigure(encoding='utf-8')

root_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(root_dir)
data_dir = os.path.join(root_dir, "data")
os.makedirs(data_dir, exist_ok=True)

rep_log_path = os.path.join(data_dir, "replacement-log.json")
stock_log_path = os.path.join(data_dir, "stock-data.json")
shoot_log_path = os.path.join(data_dir, "shoot-data.json")
master_log_path = os.path.join(root_dir, "ComponentMaster.json")

def col_to_num(col_str):
    num = 0
    for c in col_str:
        num = num * 26 + (ord(c.upper()) - ord('A')) + 1
    return num

def parse_cell_ref(ref):
    match = re.match(r'([A-Z]+)([0-9]+)', ref)
    if match:
        return col_to_num(match.group(1)), int(match.group(2))
    return 1, 1

def is_valid_part_name(p):
    if not p:
        return False
    s = str(p).strip()
    if not s or s in ['0', '1', '-', '·'] or s.lower() in ['part', 'no', 'sum', 'stt', 'tổng', 'total', '0/0', '1/1', '0/0/0', '1/1/1']:
        return False
    return True

def parse_excel_date(val):
    if not val:
        return ""
    try:
        n = float(val)
        if n > 30000:
            return (datetime(1899, 12, 30) + timedelta(days=n)).strftime('%Y-%m-%d')
    except:
        pass
    s = str(val).strip()
    match = re.match(r'^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$', s)
    if match:
        return f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
    match_d = re.match(r'^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$', s)
    if match_d:
        return f"{int(match_d.group(3)):04d}-{int(match_d.group(2)):02d}-{int(match_d.group(1)):02d}"
    return s

def auto_sync():
    candidate_files = []
    for search_path in [parent_dir, root_dir]:
        if os.path.exists(search_path):
            for fname in os.listdir(search_path):
                if fname.endswith('.xlsx') and not fname.startswith('~$'):
                    full_path = os.path.join(search_path, fname)
                    candidate_files.append(full_path)

    if not candidate_files:
        print("ℹ️ No Excel files found to auto-sync.")
        return

    master_map = {}
    if os.path.exists(master_log_path):
        try:
            with open(master_log_path, 'r', encoding='utf-8') as f:
                existing_master = json.load(f)
                for m in existing_master:
                    if m.get('PartName'):
                        master_map[f"{m.get('PartName','')}|{m.get('NewDieSet') or m.get('OldDieSet')}"] = m
        except Exception:
            pass

    replacements = []
    stock_data = {}
    shoot_records = {}
    synced_sheets_count = 0

    for file_path in candidate_files:
        try:
            with zipfile.ZipFile(file_path, 'r') as z:
                if 'xl/workbook.xml' not in z.namelist():
                    continue

                wb_xml = ET.fromstring(z.read('xl/workbook.xml'))
                wb_rels_xml = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
                rel_map = {rel.attrib.get('Id'): ('xl/' + rel.attrib.get('Target') if not rel.attrib.get('Target').startswith('xl/') else rel.attrib.get('Target')) for rel in wb_rels_xml}
                
                shared_strings = []
                if 'xl/sharedStrings.xml' in z.namelist():
                    ss_xml = ET.fromstring(z.read('xl/sharedStrings.xml'))
                    for si in ss_xml.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
                        texts = [t.text or '' for t in si.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')]
                        shared_strings.append(''.join(texts))

                # Process PartList Sheet if present (e.g. PartList, PartCatalog, Parts)
                for s in wb_xml.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
                    s_name = s.attrib.get('name', '').strip()
                    target_path = rel_map.get(s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'))
                    if 'part' in s_name.lower() and target_path in z.namelist():
                        try:
                            ws_xml = ET.fromstring(z.read(target_path))
                            sheet_data = ws_xml.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData')
                            if sheet_data is not None:
                                rows = sheet_data.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row')
                                if len(rows) > 1:
                                    for row_elem in rows[1:]:
                                        r_dict = {}
                                        for c in row_elem.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                                            r_ref = c.attrib.get('r', '')
                                            t = c.attrib.get('t', '')
                                            v_elem = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                                            val = v_elem.text if v_elem is not None else ''
                                            if t == 's' and val.isdigit():
                                                idx = int(val)
                                                if idx < len(shared_strings):
                                                    val = shared_strings[idx]
                                            elif t == 'inlineStr':
                                                is_elem = c.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                                                if is_elem is not None:
                                                    val = is_elem.text or ''
                                            col_num, _ = parse_cell_ref(r_ref)
                                            v_str = str(val).strip()
                                            if v_str:
                                                r_dict[col_num] = v_str

                                        p_name = r_dict.get(1, '')
                                        p_series = r_dict.get(2, '')
                                        p_old = r_dict.get(3, '')
                                        p_new = r_dict.get(4, '')

                                        if is_valid_part_name(p_name):
                                            old_dieset = p_old or p_new or p_name
                                            new_dieset = p_new or p_old or p_name
                                            m_key = f"{p_name}|{new_dieset}"
                                            if m_key not in master_map:
                                                master_map[m_key] = {
                                                    "PartName": p_name,
                                                    "Series": p_series,
                                                    "OldDieSet": old_dieset,
                                                    "NewDieSet": new_dieset,
                                                    "StandardStock": 1,
                                                    "StockLeft": 0
                                                }
                                            else:
                                                if p_series and not master_map[m_key].get("Series"): master_map[m_key]["Series"] = p_series
                                                if p_old and not master_map[m_key].get("OldDieSet"): master_map[m_key]["OldDieSet"] = p_old
                                                if p_new and not master_map[m_key].get("NewDieSet"): master_map[m_key]["NewDieSet"] = p_new
                        except Exception as e_part:
                            print(f"⚠️ Error parsing part list sheet {s_name}: {e_part}")

                # Process Shoot Data Sheet if present (e.g. ShootNumber, ShootMonth, Shoot)
                for s in wb_xml.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
                    s_name = s.attrib.get('name', '').strip()
                    target_path = rel_map.get(s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'))
                    if 'shoot' in s_name.lower() and target_path in z.namelist():
                        try:
                            ws_xml = ET.fromstring(z.read(target_path))
                            sheet_data = ws_xml.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData')
                            if sheet_data is not None:
                                rows = sheet_data.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row')
                                if len(rows) > 1:
                                    for row_elem in rows[1:]:
                                        r_dict = {}
                                        for c in row_elem.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                                            r_ref = c.attrib.get('r', '')
                                            t = c.attrib.get('t', '')
                                            v_elem = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                                            val = v_elem.text if v_elem is not None else ''
                                            if t == 's' and val.isdigit():
                                                idx = int(val)
                                                if idx < len(shared_strings):
                                                    val = shared_strings[idx]
                                            elif t == 'inlineStr':
                                                is_elem = c.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                                                if is_elem is not None:
                                                    val = is_elem.text or ''
                                            col_num, _ = parse_cell_ref(r_ref)
                                            v_str = str(val).strip()
                                            if v_str:
                                                r_dict[col_num] = v_str

                                        dt_raw = r_dict.get(1, '')
                                        mold_raw = r_dict.get(2, '')
                                        out_raw = r_dict.get(3, '')

                                        if dt_raw and mold_raw and out_raw:
                                            dt_str = parse_excel_date(dt_raw)
                                            try:
                                                num_out = float(out_raw)
                                                if dt_str and num_out > 0:
                                                    key = f"{dt_str}|{mold_raw}"
                                                    shoot_records[key] = shoot_records.get(key, 0) + num_out
                                            except:
                                                pass
                        except Exception as e_shoot:
                            print(f"⚠️ Error parsing shoot sheet {s_name}: {e_shoot}")

                month_sheets = []
                for s in wb_xml.findall('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheet'):
                    name = s.attrib.get('name', '').strip()
                    target_path = rel_map.get(s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'))
                    
                    m_match = re.match(r'^(\d{1,2})[-/](\d{4})$', name)
                    if not m_match:
                        continue
                        
                    m_num = int(m_match.group(1))
                    y_num = int(m_match.group(2))
                    ym = f"{y_num:04d}-{m_num:02d}"
                    month_sheets.append((ym, name, target_path))

                month_sheets.sort(key=lambda x: x[0])

                for ym, sheet_name, target_path in month_sheets:
                    if target_path not in z.namelist():
                        continue
                    ws_xml = ET.fromstring(z.read(target_path))
                    sheet_data = ws_xml.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData')
                    if sheet_data is None:
                        continue

                    synced_sheets_count += 1
                    for row_elem in sheet_data.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row'):
                        r_idx = int(row_elem.attrib.get('r', 0))
                        row_dict = {}
                        for c in row_elem.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
                            r_ref = c.attrib.get('r', '')
                            t = c.attrib.get('t', '')
                            v_elem = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
                            val = v_elem.text if v_elem is not None else ''
                            if t == 's' and val.isdigit():
                                idx = int(val)
                                if idx < len(shared_strings):
                                    val = shared_strings[idx]
                            elif t == 'inlineStr':
                                is_elem = c.find('.//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')
                                if is_elem is not None:
                                    val = is_elem.text or ''
                            col_num, _ = parse_cell_ref(r_ref)
                            v_str = str(val).strip()
                            if v_str:
                                row_dict[col_num] = v_str

                        if r_idx < 8:
                            continue

                        part_full = row_dict.get(1, '').strip()
                        if not part_full or part_full.lower() in ['part', 'no', 'part/series/mold', 'total', 'stt', 'tổng']:
                            continue

                        tokens = [p.strip() for p in part_full.split('/') if p.strip()]
                        if len(tokens) >= 3:
                            part_name = tokens[0]
                            series = tokens[1]
                            mold = tokens[2]
                        elif len(tokens) == 2:
                            part_name = tokens[0]
                            series = ""
                            mold = tokens[1]
                        else:
                            part_name = tokens[0]
                            series = ""
                            mold = tokens[0]

                        if not is_valid_part_name(part_name):
                            continue

                        try:
                            min_stock = int(float(row_dict.get(2, '1')))
                        except:
                            min_stock = 1

                        try:
                            old_stock = int(float(row_dict.get(3, '0')))
                        except:
                            old_stock = 0

                        # Save / update Master Item (preserving NewDieSet vs OldDieSet mapping)
                        m_key = f"{part_name}|{mold}"
                        master_item = master_map.get(m_key)
                        if not master_item:
                            for ex_item in master_map.values():
                                if ex_item.get("PartName") == part_name and (ex_item.get("OldDieSet") == mold or ex_item.get("NewDieSet") == mold):
                                    master_item = ex_item
                                    break

                        if master_item:
                            old_dieset = master_item.get("OldDieSet") or mold
                            new_dieset = master_item.get("NewDieSet") or mold
                            master_item["StockLeft"] = old_stock
                            if series and not master_item.get("Series"):
                                master_item["Series"] = series
                        else:
                            old_dieset = mold
                            new_dieset = mold
                            master_map[m_key] = {
                                "PartName": part_name,
                                "Series": series,
                                "OldDieSet": old_dieset,
                                "NewDieSet": new_dieset,
                                "StandardStock": min_stock,
                                "StockLeft": old_stock
                            }

                        # Determine remaining stock from rightmost columns
                        curr_ton = old_stock
                        for col_ton in [26, 22, 18, 14, 10]:
                            if col_ton in row_dict:
                                try:
                                    curr_ton = int(float(row_dict[col_ton]))
                                    break
                                except:
                                    pass

                        if m_key not in stock_data:
                            stock_data[m_key] = {
                                "stock": curr_ton if curr_ton >= 0 else 0,
                                "minStock": min_stock if min_stock > 0 else 1,
                                "series": series,
                                "minStockByMonth": {}
                            }
                        if "minStockByMonth" not in stock_data[m_key]:
                            stock_data[m_key]["minStockByMonth"] = {}
                        
                        m_val = min_stock if min_stock > 0 else 1
                        stock_data[m_key]["minStockByMonth"][ym] = m_val
                        stock_data[m_key]["stock"] = curr_ton if curr_ton >= 0 else 0
                        stock_data[m_key]["series"] = series

                        if master_item:
                            master_item["StockLeft"] = curr_ton

                        # 5 OUT SPARE PART GROUPS
                        out_cols = [(7,8,9), (11,12,13), (15,16,17), (19,20,21), (23,24,25)]
                        for group_idx, (c_qty, c_id, c_date) in enumerate(out_cols):
                            qty_raw = row_dict.get(c_qty, '').strip()
                            id_raw = row_dict.get(c_id, '').strip()
                            date_raw = row_dict.get(c_date, '').strip()

                            if qty_raw or date_raw or id_raw:
                                try:
                                    qty_val = int(float(qty_raw)) if qty_raw else 1
                                except:
                                    qty_val = 1

                                try:
                                    day_val = int(float(date_raw)) if date_raw else 1
                                except:
                                    day_val = 1

                                day_clamped = max(1, min(31, day_val))
                                full_date = f"{ym}-{day_clamped:02d}"

                                replacements.append({
                                    "Part": part_name,
                                    "Series": series,
                                    "DieSet": mold,
                                    "NewDieSet": mold,
                                    "OldDieSet": mold,
                                    "ReplaceDate": full_date,
                                    "Label": str(qty_val),
                                    "RequestId": id_raw
                                })

        except Exception as err:
            print(f"⚠️ Error reading {file_path}: {err}")

    if shoot_records:
        shoot_list = []
        for key, total_out in shoot_records.items():
            dt, mold = key.split('|', 1)
            shoot_list.append({
                "Date": dt,
                "Part": "",
                "DieSet": mold,
                "Output": int(total_out) if float(total_out).is_integer() else total_out
            })
        shoot_list.sort(key=lambda x: (x["Date"], x["DieSet"]))
        with open(shoot_log_path, 'w', encoding='utf-8') as f:
            json.dump(shoot_list, f, ensure_ascii=False, indent=2)
        print(f"⚡ Auto-sync updated shoot data: {len(shoot_list)} shoot records saved to shoot-data.json")

    if synced_sheets_count > 0:
        replacements.sort(key=lambda x: x["ReplaceDate"])

        with open(rep_log_path, 'w', encoding='utf-8') as f:
            json.dump(replacements, f, ensure_ascii=False, indent=2)

        with open(stock_log_path, 'w', encoding='utf-8') as f:
            json.dump(stock_data, f, ensure_ascii=False, indent=2)

        master_list_final = list(master_map.values())
        with open(master_log_path, 'w', encoding='utf-8') as f:
            json.dump(master_list_final, f, ensure_ascii=False, indent=2)

        print(f"🔄 Auto-sync completed! ({synced_sheets_count} sheets, {len(replacements)} replacements, {len(master_list_final)} master items)")

if __name__ == '__main__':
    auto_sync()
