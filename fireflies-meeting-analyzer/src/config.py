"""
Konfigurationsmodul für die Fireflies Meeting Analyzer Anwendung.
"""

import os
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field
from dotenv import load_dotenv

load_dotenv()


class Settings(BaseSettings):
    """Anwendungskonfiguration mit Umgebungsvariablen."""

    # Fireflies API
    fireflies_api_key: str = Field(default="", alias="FIREFLIES_API_KEY")
    fireflies_api_url: str = "https://api.fireflies.ai/graphql"

    # AI Provider
    ai_provider: str = Field(default="anthropic", alias="AI_PROVIDER")
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    openai_api_key: str = Field(default="", alias="OPENAI_API_KEY")

    # Application Settings
    dashboard_language: str = Field(default="de", alias="DASHBOARD_LANGUAGE")
    cache_duration_hours: int = Field(default=1, alias="CACHE_DURATION_HOURS")
    max_meetings_per_request: int = Field(default=50, alias="MAX_MEETINGS_PER_REQUEST")
    export_dir: str = Field(default="./exports", alias="EXPORT_DIR")

    # Company Context
    company_name: str = Field(default="CopeCart", alias="COMPANY_NAME")
    host_emails_raw: str = Field(default="", alias="HOST_EMAILS")

    @property
    def host_emails(self) -> List[str]:
        """Parst die Host-E-Mails aus der Umgebungsvariable."""
        if not self.host_emails_raw:
            return []
        return [email.strip() for email in self.host_emails_raw.split(",") if email.strip()]

    def validate_config(self) -> dict:
        """Validiert die Konfiguration und gibt Statusmeldungen zurück."""
        status = {
            "fireflies_api": bool(self.fireflies_api_key),
            "ai_provider": False,
            "ready": False,
            "messages": []
        }

        if not self.fireflies_api_key:
            status["messages"].append("Fireflies API Key fehlt. Bitte in .env konfigurieren.")

        if self.ai_provider == "anthropic":
            status["ai_provider"] = bool(self.anthropic_api_key)
            if not self.anthropic_api_key:
                status["messages"].append("Anthropic API Key fehlt. Bitte in .env konfigurieren.")
        elif self.ai_provider == "openai":
            status["ai_provider"] = bool(self.openai_api_key)
            if not self.openai_api_key:
                status["messages"].append("OpenAI API Key fehlt. Bitte in .env konfigurieren.")
        else:
            status["messages"].append(f"Unbekannter AI Provider: {self.ai_provider}")

        status["ready"] = status["fireflies_api"] and status["ai_provider"]

        return status

    class Config:
        env_file = ".env"
        extra = "ignore"


# Globale Settings-Instanz
settings = Settings()


# Zeitraum-Definitionen für Filter
TIME_PERIODS = {
    "heute": {"days": 0, "label": "Heute"},
    "letzte_woche": {"days": 7, "label": "Letzte Woche"},
    "letzter_monat": {"days": 30, "label": "Letzter Monat"},
    "letzte_3_monate": {"days": 90, "label": "Letzte 3 Monate"},
}


# UI-Texte auf Deutsch
UI_TEXTS = {
    "app_title": "Fireflies Meeting Analyzer",
    "app_subtitle": "Lead-Analyse Dashboard für CopeCart",
    "filter_section": "Filter",
    "time_period": "Zeitraum",
    "host_filter": "Meeting Host",
    "all_hosts": "Alle Hosts",
    "analyze_button": "Meetings analysieren",
    "loading": "Lade Meetings...",
    "analyzing": "Analysiere Transkripte...",
    "no_meetings": "Keine Meetings im gewählten Zeitraum gefunden.",
    "error": "Fehler",
    "success": "Erfolgreich",

    # Deliverables
    "customer_profile": "Kunden-Insight-Profil",
    "pain_points": "Pain Point Matrix",
    "objections": "Einwand-Analyse",
    "sales_guide": "Vertriebsoptimierung",
    "language_analysis": "Sprachanalyse",
    "marketing_framework": "Marketing-Framework",
    "messaging_guide": "Messaging-Leitfaden",
    "questions": "Lead-Fragen",

    # Export
    "export_section": "Export",
    "export_excel": "Als Excel exportieren",
    "export_markdown": "Als Markdown exportieren",
    "export_json": "Als JSON exportieren",
}
