# Fireflies Meeting Analyzer

Eine lokale Automation zur Analyse von Meeting-Transkripten aus Fireflies.ai. Das Tool hilft dabei, Leads besser zu verstehen und zu erkennen, was sie zu Kunden konvertiert.

## Features

- **Zeitraum-Filter**: Heute, letzte Woche, letzter Monat, letzte 3 Monate
- **Host-Filter**: Meetings nach Organisator filtern
- **Lead-Fokus**: Nur Aussagen der Leads werden analysiert (Host wird ignoriert)
- **KI-gestützte Analyse**: Verwendet Claude (Anthropic) oder GPT (OpenAI)
- **Deutsches Dashboard**: Vollständig auf Deutsch

### Generierte Insights

1. **Kunden-Insight-Profile** - Unternehmensdetails, Entscheider-Rollen, Geschäftskontext
2. **Pain Point Matrix** - Alle Herausforderungen mit direkten Zitaten und Impact-Analyse
3. **Lead-Fragen** - Dokumentierte Fragen mit zugrundeliegenden Sorgen
4. **Einwand-Analyse** - Einwände, emotionale Töne, Lösungswege, Conversion Trigger
5. **Sprachanalyse** - Fachterminologie, emotionale Sprache, Power Words, Metaphern
6. **Marketing-Framework** - Value Propositions und Empfehlungen basierend auf Kundensprache
7. **Messaging-Leitfaden** - Effektive Begriffe und Conversion Triggers

### Export-Formate

- Excel (.xlsx)
- Markdown (.md)
- JSON (.json)

## Installation

### 1. Python-Umgebung erstellen

```bash
cd fireflies-meeting-analyzer

# Virtuelle Umgebung erstellen
python -m venv venv

# Aktivieren (Linux/Mac)
source venv/bin/activate

# Aktivieren (Windows)
venv\Scripts\activate
```

### 2. Abhängigkeiten installieren

```bash
pip install -r requirements.txt
```

### 3. Konfiguration

```bash
# Beispiel-Konfiguration kopieren
cp .env.example .env

# .env bearbeiten und API Keys eintragen
```

#### Benötigte API Keys

1. **Fireflies API Key**
   - Gehe zu https://app.fireflies.ai/integrations
   - Klicke auf "Fireflies API"
   - Kopiere den API Key

2. **AI Provider Key** (einer von beiden)
   - **Anthropic (empfohlen)**: https://console.anthropic.com/
   - **OpenAI**: https://platform.openai.com/api-keys

#### .env Konfiguration

```env
# Fireflies API
FIREFLIES_API_KEY=your_fireflies_api_key_here

# AI Provider (anthropic oder openai)
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Optional: OpenAI als Alternative
# AI_PROVIDER=openai
# OPENAI_API_KEY=your_openai_api_key_here

# Firmenname (wird im Dashboard und in Prompts verwendet)
COMPANY_NAME=CopeCart

# Host-E-Mails zum Ausschließen (kommasepariert)
HOST_EMAILS=sales@company.com,host@company.com
```

## Verwendung

### Dashboard starten

```bash
streamlit run app.py
```

Das Dashboard öffnet sich automatisch im Browser unter `http://localhost:8501`

### Workflow

1. **Zeitraum wählen**: Heute, letzte Woche, letzter Monat, letzte 3 Monate
2. **Host filtern** (optional): Nur Meetings eines bestimmten Hosts analysieren
3. **Host-Namen eingeben**: Namen/E-Mails der Hosts, deren Aussagen ignoriert werden sollen
4. **"Meetings analysieren" klicken**: Startet den Analyseprozess

### Analyse-Prozess

1. Meetings werden von Fireflies.ai geladen
2. Für jedes Meeting werden die vollständigen Transkripte abgerufen
3. Host-Aussagen werden herausgefiltert
4. Nur Lead-Aussagen werden an die KI zur Analyse gesendet
5. Ergebnisse werden im Dashboard angezeigt

## Projektstruktur

```
fireflies-meeting-analyzer/
├── app.py                  # Streamlit Dashboard
├── requirements.txt        # Python-Abhängigkeiten
├── .env.example           # Beispiel-Konfiguration
├── .env                   # Lokale Konfiguration (nicht committen!)
├── src/
│   ├── __init__.py
│   ├── config.py          # Konfigurationsmodul
│   ├── fireflies_client.py # Fireflies API Client
│   ├── ai_analyzer.py     # KI-Analyse Engine
│   └── exporter.py        # Export-Funktionen
├── exports/               # Exportierte Reports
├── data/                  # Gecachte Daten
└── tests/                 # Tests
```

## API-Limitierungen

### Fireflies.ai
- Kostenloser Plan: 50 API-Calls pro Tag
- Business Plan: Unbegrenzte API-Calls
- Rate Limit: Das Tool wartet automatisch zwischen Anfragen

### AI Provider
- **Anthropic**: Standard Rate Limits gelten
- **OpenAI**: Standard Rate Limits gelten

## Troubleshooting

### "Fireflies API Key fehlt"
- Prüfe ob `.env` existiert
- Prüfe ob `FIREFLIES_API_KEY` gesetzt ist
- Starte die App neu nach Änderungen an `.env`

### "Keine Meetings gefunden"
- Prüfe den gewählten Zeitraum
- Stelle sicher, dass Meetings in Fireflies existieren
- Prüfe ob der Host-Filter korrekt ist

### "KI-Analyse Fehler"
- Prüfe ob der AI Provider Key korrekt ist
- Prüfe ob genug API-Credits vorhanden sind
- Bei sehr langen Transkripten kann das Token-Limit erreicht werden

### "Import Error"
- Stelle sicher, dass alle Abhängigkeiten installiert sind: `pip install -r requirements.txt`
- Prüfe ob die virtuelle Umgebung aktiviert ist

## Qualitätsstandards

Das Tool folgt diesen Qualitätsstandards:

- Jede Erkenntnis enthält mindestens ein direktes Kundenzitat
- Pain Points werden mit Kontext und Auswirkung dokumentiert
- Alle Empfehlungen basieren auf tatsächlichen Transkript-Aussagen
- Keine Paraphrasierung - nur Original-Zitate

## Datenschutz

- Alle Daten werden lokal verarbeitet
- Meeting-Transkripte werden nur an Fireflies.ai und den gewählten AI Provider gesendet
- Keine Daten werden an Dritte weitergegeben
- API Keys werden nur lokal in `.env` gespeichert

## Lizenz

Dieses Projekt ist für den internen Gebrauch bestimmt.
