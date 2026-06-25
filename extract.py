import os
import json
import pandas as pd

try:
    print("⏳ Loading lka_admin_boundaries.xlsx (Sheet: lka_admin4)...")
    # Read the explicit GN level sheet from the spreadsheet
    df = pd.read_excel('lka_admin_boundaries.xlsx', sheet_name='lka_admin4')
    
    # Filter out empty rows and select English naming columns
    clean_df = df[['adm1_name', 'adm2_name', 'adm3_name', 'adm4_name']].dropna()
    
    formatted_data = []
    print("⚙️ Processing 14,000+ administrative divisions...")
    
    for _, row in clean_df.iterrows():
        formatted_data.append({
            "province": str(row['adm1_name']).strip(),
            "district": str(row['adm2_name']).strip(),
            "city": str(row['adm3_name']).strip(),
            "village": str(row['adm4_name']).strip()
        })
        
    # Ensure the target data directory exists
    os.makedirs('data', exist_ok=True)
    
    # Save directly to your backend's layout structure
    with open('data/srilanka_locations.json', 'w', encoding='utf-8') as f:
        json.dump(formatted_data, f, indent=2, ensure_ascii=False)
        
    print(f"✅ Success! Generated data/srilanka_locations.json with {len(formatted_data)} clean rows.")

except Exception as e:
    print(f"❌ Extraction failed: {str(e)}")
    print("Tip: Run 'pip install pandas openpyxl' if your local python environment lacks Excel support.")