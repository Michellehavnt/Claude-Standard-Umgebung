#!/bin/bash
# Fireflies Meeting Analyzer - Startskript

# Verzeichnis ermitteln
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Prüfe ob virtuelle Umgebung existiert
if [ ! -d "venv" ]; then
    echo "Erstelle virtuelle Umgebung..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Prüfe .env
if [ ! -f ".env" ]; then
    echo "FEHLER: .env Datei nicht gefunden!"
    echo "Bitte kopiere .env.example zu .env und trage deine API Keys ein."
    exit 1
fi

# Starte Dashboard
echo "Starte Fireflies Meeting Analyzer..."
echo "Dashboard öffnet sich unter: http://localhost:8501"
echo ""
streamlit run app.py
