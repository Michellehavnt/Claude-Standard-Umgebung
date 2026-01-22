"""
Fireflies Meeting Analyzer - Streamlit Dashboard
Lokale Automation zur Analyse von Meeting-Transkripten.
"""

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from datetime import datetime, timedelta
import json
import sys
from pathlib import Path

# Füge src zum Path hinzu
sys.path.insert(0, str(Path(__file__).parent))

from src.config import settings, TIME_PERIODS, UI_TEXTS
from src.fireflies_client import FirefliesClient, FirefliesAPIError, Meeting
from src.ai_analyzer import AIAnalyzer, AnalysisResult
from src.exporter import ReportExporter

# Page Config
st.set_page_config(
    page_title="Fireflies Meeting Analyzer",
    page_icon="🎯",
    layout="wide",
    initial_sidebar_state="expanded"
)

# Custom CSS
st.markdown("""
<style>
    .main-header {
        font-size: 2.5rem;
        font-weight: bold;
        color: #1f77b4;
        margin-bottom: 0.5rem;
    }
    .sub-header {
        font-size: 1.2rem;
        color: #666;
        margin-bottom: 2rem;
    }
    .metric-card {
        background-color: #f0f2f6;
        border-radius: 10px;
        padding: 1rem;
        margin: 0.5rem 0;
    }
    .quote-box {
        background-color: #f8f9fa;
        border-left: 4px solid #1f77b4;
        padding: 1rem;
        margin: 0.5rem 0;
        font-style: italic;
    }
    .pain-high { border-left-color: #e74c3c; }
    .pain-medium { border-left-color: #f39c12; }
    .pain-low { border-left-color: #27ae60; }
    .category-tag {
        display: inline-block;
        background-color: #e9ecef;
        padding: 0.2rem 0.6rem;
        border-radius: 15px;
        font-size: 0.8rem;
        margin-right: 0.5rem;
    }
</style>
""", unsafe_allow_html=True)


def init_session_state():
    """Initialisiert den Session State."""
    if "analysis_result" not in st.session_state:
        st.session_state.analysis_result = None
    if "meetings_cache" not in st.session_state:
        st.session_state.meetings_cache = {}
    if "hosts_list" not in st.session_state:
        st.session_state.hosts_list = []
    if "error_message" not in st.session_state:
        st.session_state.error_message = None


def check_configuration() -> bool:
    """Prüft ob die Konfiguration vollständig ist."""
    status = settings.validate_config()

    if not status["ready"]:
        st.error("Konfiguration unvollständig")
        for msg in status["messages"]:
            st.warning(msg)

        st.info("""
        **Setup-Anleitung:**
        1. Kopiere `.env.example` zu `.env`
        2. Füge deinen Fireflies API Key ein (von https://app.fireflies.ai/integrations)
        3. Füge deinen Anthropic oder OpenAI API Key ein
        4. Starte die App neu
        """)
        return False
    return True


def load_hosts():
    """Lädt die Liste der verfügbaren Hosts."""
    if not st.session_state.hosts_list:
        try:
            with FirefliesClient() as client:
                st.session_state.hosts_list = client.get_all_hosts()
        except Exception as e:
            st.error(f"Fehler beim Laden der Hosts: {e}")


def render_sidebar():
    """Rendert die Sidebar mit Filtern."""
    st.sidebar.markdown("## Filter")

    # Zeitraum Filter
    time_options = {v["label"]: k for k, v in TIME_PERIODS.items()}
    selected_label = st.sidebar.selectbox(
        "Zeitraum",
        options=list(time_options.keys()),
        index=1  # Default: Letzte Woche
    )
    time_period = time_options[selected_label]

    # Host Filter
    load_hosts()
    host_options = ["Alle Hosts"] + st.session_state.hosts_list
    selected_host = st.sidebar.selectbox(
        "Meeting Host",
        options=host_options
    )
    host_filter = None if selected_host == "Alle Hosts" else selected_host

    # Host-Identifier für Ausschluss
    st.sidebar.markdown("---")
    st.sidebar.markdown("### Host-Ausschluss")
    host_identifiers = st.sidebar.text_area(
        "Host-Namen/E-Mails (einer pro Zeile)",
        help="Diese Sprecher werden als Hosts behandelt und ihre Aussagen werden nicht analysiert.",
        value="\n".join(settings.host_emails)
    )
    host_id_list = [h.strip() for h in host_identifiers.split("\n") if h.strip()]

    # Analyse Button
    st.sidebar.markdown("---")
    analyze_clicked = st.sidebar.button(
        "Meetings analysieren",
        type="primary",
        use_container_width=True
    )

    return time_period, host_filter, host_id_list, analyze_clicked


def fetch_and_analyze(time_period: str, host_filter: str, host_identifiers: list):
    """Ruft Meetings ab und führt die Analyse durch."""
    progress = st.progress(0, text="Lade Meetings...")

    try:
        # Meetings abrufen
        with FirefliesClient() as client:
            transcripts = client.get_transcripts(
                time_period=time_period,
                host_email=host_filter
            )

            if not transcripts:
                st.warning("Keine Meetings im gewählten Zeitraum gefunden.")
                return None

            progress.progress(20, text=f"{len(transcripts)} Meetings gefunden. Lade Details...")

            # Details für jedes Meeting laden
            meetings = []
            for i, t in enumerate(transcripts):
                try:
                    meeting = client.get_transcript_detail(t["id"])
                    meetings.append(meeting)
                    progress.progress(
                        20 + int(60 * (i + 1) / len(transcripts)),
                        text=f"Lade Meeting {i + 1}/{len(transcripts)}..."
                    )
                except Exception as e:
                    st.warning(f"Fehler bei Meeting {t.get('title', 'Unknown')}: {e}")

        if not meetings:
            st.error("Keine Meeting-Details konnten geladen werden.")
            return None

        # KI-Analyse
        progress.progress(80, text="Analysiere Transkripte mit KI...")

        analyzer = AIAnalyzer()
        result = analyzer.analyze_meetings(meetings, host_identifiers)

        progress.progress(100, text="Analyse abgeschlossen!")

        return result

    except FirefliesAPIError as e:
        st.error(f"Fireflies API Fehler: {e}")
        return None
    except Exception as e:
        st.error(f"Fehler bei der Analyse: {e}")
        import traceback
        st.code(traceback.format_exc())
        return None


def render_overview(result: AnalysisResult):
    """Rendert die Übersichts-Metriken."""
    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.metric("Analysierte Meetings", result.meetings_analyzed)

    with col2:
        st.metric("Lead-Aussagen", result.total_lead_statements)

    with col3:
        st.metric("Pain Points", len(result.pain_points))

    with col4:
        st.metric("Fragen", len(result.questions))


def render_pain_points(result: AnalysisResult):
    """Rendert die Pain Point Matrix."""
    st.markdown("### Pain Point Matrix")

    if not result.pain_points:
        st.info("Keine Pain Points identifiziert.")
        return

    # Visualisierung nach Kategorie
    if result.top_pain_categories:
        fig = px.pie(
            values=list(result.top_pain_categories.values()),
            names=list(result.top_pain_categories.keys()),
            title="Pain Points nach Kategorie"
        )
        st.plotly_chart(fig, use_container_width=True)

    # Filter
    categories = list(set(pp.category for pp in result.pain_points))
    selected_cat = st.selectbox("Kategorie filtern", ["Alle"] + categories)

    # Liste der Pain Points
    filtered = result.pain_points
    if selected_cat != "Alle":
        filtered = [pp for pp in result.pain_points if pp.category == selected_cat]

    for pp in filtered:
        priority_class = {
            "Hoch": "pain-high",
            "Mittel": "pain-medium",
            "Niedrig": "pain-low"
        }.get(pp.impact_level, "")

        with st.expander(f"{pp.description} — {pp.impact_level}"):
            st.markdown(f"**Kategorie:** {pp.category}")
            st.markdown(f"""
            <div class="quote-box {priority_class}">
                "{pp.direct_quote}"
                <br><small>— {pp.speaker}</small>
            </div>
            """, unsafe_allow_html=True)

            if pp.context:
                st.markdown(f"**Kontext:** {pp.context}")
            if pp.desired_outcome:
                st.markdown(f"**Gewünschtes Ergebnis:** {pp.desired_outcome}")
            if pp.impact_statement:
                st.markdown(f"**Auswirkung:** {pp.impact_statement}")


def render_questions(result: AnalysisResult):
    """Rendert die Lead-Fragen."""
    st.markdown("### Lead-Fragen")

    if not result.questions:
        st.info("Keine Fragen identifiziert.")
        return

    # Gruppiere nach Kategorie
    categories = list(set(q.category for q in result.questions))

    # Tabs für Kategorien
    if categories:
        tabs = st.tabs(["Alle"] + categories)

        with tabs[0]:
            for q in result.questions:
                with st.expander(q.text):
                    st.markdown(f"**Sprecher:** {q.speaker}")
                    st.markdown(f"**Kategorie:** {q.category}")
                    if q.underlying_concern:
                        st.markdown(f"**Zugrundeliegende Sorge:** {q.underlying_concern}")
                    if q.context:
                        st.markdown(f"**Kontext:** {q.context}")

        for i, cat in enumerate(categories, 1):
            with tabs[i]:
                cat_questions = [q for q in result.questions if q.category == cat]
                for q in cat_questions:
                    with st.expander(q.text):
                        st.markdown(f"**Sprecher:** {q.speaker}")
                        if q.underlying_concern:
                            st.markdown(f"**Zugrundeliegende Sorge:** {q.underlying_concern}")


def render_objections(result: AnalysisResult):
    """Rendert die Einwand-Analyse."""
    st.markdown("### Einwand-Analyse")

    if not result.objections:
        st.info("Keine Einwände identifiziert.")
        return

    for obj in result.objections:
        with st.expander(obj.objection_text):
            st.markdown(f"""
            <div class="quote-box">
                "{obj.direct_quote}"
                <br><small>— {obj.speaker}</small>
            </div>
            """, unsafe_allow_html=True)

            col1, col2 = st.columns(2)

            with col1:
                if obj.emotional_undertone:
                    st.markdown(f"**Emotionale Färbung:** {obj.emotional_undertone}")
                if obj.root_cause:
                    st.markdown(f"**Ursache:** {obj.root_cause}")

            with col2:
                if obj.resolution_pathway:
                    st.markdown(f"**Lösungsweg:** {obj.resolution_pathway}")
                if obj.conversion_trigger:
                    st.success(f"**Conversion Trigger:** {obj.conversion_trigger}")


def render_language_analysis(result: AnalysisResult):
    """Rendert die Sprachanalyse."""
    st.markdown("### Sprachanalyse")

    if not result.language_patterns:
        st.info("Keine Sprachmuster identifiziert.")
        return

    category_names = {
        "industry_term": "Fachterminologie",
        "emotional": "Emotionale Sprache",
        "power_word": "Power Words",
        "metaphor": "Metaphern & Analogien"
    }

    tabs = st.tabs(list(category_names.values()))

    for i, (cat_key, cat_name) in enumerate(category_names.items()):
        with tabs[i]:
            patterns = [lp for lp in result.language_patterns if lp.category == cat_key]
            if patterns:
                for lp in patterns:
                    st.markdown(f"**\"{lp.phrase}\"** — *{lp.speaker}*")
                    if lp.context:
                        st.caption(f"Kontext: {lp.context}")
                    st.markdown("---")
            else:
                st.info(f"Keine {cat_name} gefunden.")


def render_marketing_framework(result: AnalysisResult):
    """Rendert das Marketing-Framework."""
    st.markdown("### Marketing-Framework")

    col1, col2 = st.columns(2)

    with col1:
        st.markdown("#### Value Propositions")
        if result.value_propositions:
            for vp in result.value_propositions:
                with st.expander(vp.get("customer_need", "Value Proposition")[:50] + "..."):
                    st.markdown(f"**Kundenbedürfnis:** {vp.get('customer_need', '-')}")
                    st.markdown(f"**Lösung:** {vp.get('solution_alignment', '-')}")
                    st.markdown(f"**Nutzenaussage:** {vp.get('benefit_statement', '-')}")
        else:
            st.info("Keine Value Propositions generiert.")

    with col2:
        st.markdown("#### Marketing-Empfehlungen")
        if result.marketing_recommendations:
            for rec in result.marketing_recommendations:
                with st.expander(rec.get("section", "Empfehlung")):
                    if rec.get("customer_quote"):
                        st.markdown(f"""
                        <div class="quote-box">
                            "{rec.get('customer_quote')}"
                        </div>
                        """, unsafe_allow_html=True)
                    st.markdown(f"**Empfehlung:** {rec.get('recommended_message', '-')}")
        else:
            st.info("Keine Marketing-Empfehlungen generiert.")


def render_messaging_guide(result: AnalysisResult):
    """Rendert den Messaging-Leitfaden."""
    st.markdown("### Messaging-Leitfaden")

    col1, col2 = st.columns(2)

    with col1:
        st.markdown("#### Effektive Begriffe")
        if result.messaging_guidelines:
            for msg in result.messaging_guidelines:
                st.markdown(f"**{msg.get('effective_term', '-')}**")
                if msg.get("customer_quote"):
                    st.caption(f"Zitat: \"{msg.get('customer_quote')}\"")
                st.caption(f"Empfehlung: {msg.get('usage_recommendation', '-')}")
                st.markdown("---")
        else:
            st.info("Keine Messaging-Guidelines generiert.")

    with col2:
        st.markdown("#### Conversion Triggers")
        if result.conversion_triggers:
            for trigger in result.conversion_triggers:
                st.success(f"✓ {trigger}")
        else:
            st.info("Keine Conversion Triggers identifiziert.")


def render_export_section(result: AnalysisResult):
    """Rendert den Export-Bereich."""
    st.markdown("### Export")

    col1, col2, col3 = st.columns(3)

    exporter = ReportExporter()

    with col1:
        if st.button("Als Excel exportieren", use_container_width=True):
            try:
                filepath = exporter.export_to_excel(result)
                st.success(f"Exportiert: {filepath}")
                with open(filepath, "rb") as f:
                    st.download_button(
                        "Excel herunterladen",
                        f,
                        file_name=Path(filepath).name,
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    )
            except Exception as e:
                st.error(f"Export-Fehler: {e}")

    with col2:
        if st.button("Als Markdown exportieren", use_container_width=True):
            try:
                filepath = exporter.export_to_markdown(result)
                st.success(f"Exportiert: {filepath}")
                with open(filepath, "r", encoding="utf-8") as f:
                    st.download_button(
                        "Markdown herunterladen",
                        f.read(),
                        file_name=Path(filepath).name,
                        mime="text/markdown"
                    )
            except Exception as e:
                st.error(f"Export-Fehler: {e}")

    with col3:
        if st.button("Als JSON exportieren", use_container_width=True):
            try:
                filepath = exporter.export_to_json(result)
                st.success(f"Exportiert: {filepath}")
                with open(filepath, "r", encoding="utf-8") as f:
                    st.download_button(
                        "JSON herunterladen",
                        f.read(),
                        file_name=Path(filepath).name,
                        mime="application/json"
                    )
            except Exception as e:
                st.error(f"Export-Fehler: {e}")


def main():
    """Hauptfunktion der App."""
    init_session_state()

    # Header
    st.markdown('<p class="main-header">Fireflies Meeting Analyzer</p>', unsafe_allow_html=True)
    st.markdown(f'<p class="sub-header">Lead-Analyse Dashboard für {settings.company_name}</p>', unsafe_allow_html=True)

    # Konfiguration prüfen
    if not check_configuration():
        return

    # Sidebar
    time_period, host_filter, host_identifiers, analyze_clicked = render_sidebar()

    # Analyse durchführen
    if analyze_clicked:
        result = fetch_and_analyze(time_period, host_filter, host_identifiers)
        if result:
            st.session_state.analysis_result = result

    # Ergebnisse anzeigen
    result = st.session_state.analysis_result

    if result:
        st.markdown("---")

        # Übersicht
        render_overview(result)

        st.markdown("---")

        # Tabs für verschiedene Ansichten
        tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
            "Pain Points",
            "Fragen",
            "Einwände",
            "Sprachanalyse",
            "Marketing",
            "Messaging",
            "Export"
        ])

        with tab1:
            render_pain_points(result)

        with tab2:
            render_questions(result)

        with tab3:
            render_objections(result)

        with tab4:
            render_language_analysis(result)

        with tab5:
            render_marketing_framework(result)

        with tab6:
            render_messaging_guide(result)

        with tab7:
            render_export_section(result)

    else:
        st.info("""
        **Erste Schritte:**
        1. Wähle einen Zeitraum in der Sidebar
        2. Optional: Filtere nach Meeting Host
        3. Trage Host-Namen ein, deren Aussagen ausgeschlossen werden sollen
        4. Klicke auf "Meetings analysieren"

        Die App wird dann:
        - Meetings von Fireflies.ai laden
        - Nur Lead-Aussagen analysieren (Host wird ignoriert)
        - KI-gestützte Insights generieren
        """)


if __name__ == "__main__":
    main()
