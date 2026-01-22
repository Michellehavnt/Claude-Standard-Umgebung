"""
KI-basierte Analyse-Engine für Meeting-Transkripte.
Verwendet Claude (Anthropic) oder GPT (OpenAI) für tiefgehende Analysen.
"""

import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime

from .config import settings
from .fireflies_client import Meeting, Sentence


@dataclass
class CustomerProfile:
    """Kunden-Insight-Profil."""
    company_name: str = ""
    industry: str = ""
    company_size: str = ""
    decision_maker_role: str = ""
    purchasing_authority: str = ""
    business_context: str = ""
    current_solutions: List[str] = field(default_factory=list)
    budget_indicators: str = ""
    timeline_urgency: str = ""
    supporting_quotes: List[Dict[str, str]] = field(default_factory=list)


@dataclass
class PainPoint:
    """Einzelner Pain Point mit Kontext."""
    category: str  # z.B. "Technisch", "Prozess", "Kosten"
    description: str
    direct_quote: str
    speaker: str
    impact_level: str  # "Hoch", "Mittel", "Niedrig"
    context: str
    desired_outcome: str
    impact_statement: str


@dataclass
class Question:
    """Frage eines Leads."""
    text: str
    speaker: str
    category: str  # z.B. "Preis", "Funktionen", "Integration"
    underlying_concern: str
    context: str


@dataclass
class Objection:
    """Einwand mit Analyse."""
    objection_text: str
    direct_quote: str
    speaker: str
    emotional_undertone: str
    root_cause: str
    resolution_pathway: str
    conversion_trigger: str


@dataclass
class LanguagePattern:
    """Sprachmuster aus Kundengesprächen."""
    category: str  # "industry_term", "emotional", "power_word", "metaphor"
    phrase: str
    context: str
    speaker: str
    usage_count: int = 1


@dataclass
class AnalysisResult:
    """Vollständiges Analyseergebnis."""
    timestamp: datetime = field(default_factory=datetime.now)
    meetings_analyzed: int = 0
    total_lead_statements: int = 0

    # Deliverables
    customer_profiles: List[CustomerProfile] = field(default_factory=list)
    pain_points: List[PainPoint] = field(default_factory=list)
    questions: List[Question] = field(default_factory=list)
    objections: List[Objection] = field(default_factory=list)
    language_patterns: List[LanguagePattern] = field(default_factory=list)

    # Aggregierte Insights
    top_pain_categories: Dict[str, int] = field(default_factory=dict)
    common_questions: List[str] = field(default_factory=list)
    conversion_triggers: List[str] = field(default_factory=list)
    value_propositions: List[Dict[str, str]] = field(default_factory=list)
    marketing_recommendations: List[Dict[str, str]] = field(default_factory=list)
    messaging_guidelines: List[Dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> Dict:
        """Konvertiert das Ergebnis in ein Dictionary."""
        result = asdict(self)
        result["timestamp"] = self.timestamp.isoformat()
        return result


class AIAnalyzer:
    """KI-gestützte Analyse von Meeting-Transkripten."""

    SYSTEM_PROMPT = """Du bist ein erfahrener Sales-Analyst, der Meeting-Transkripte analysiert, um wertvolle Insights über potenzielle Kunden (Leads) zu gewinnen.

KONTEXT:
- Unternehmen: {company_name}
- Ziel: Leads besser verstehen und Konversionsraten verbessern
- Fokus: Nur Aussagen der LEADS analysieren, NICHT die des Sales-Teams/Hosts

DEINE AUFGABEN:
1. Extrahiere DIREKTE ZITATE der Leads - keine Paraphrasierung
2. Identifiziere Pain Points, Einwände und Fragen
3. Erkenne emotionale Auslöser und Kaufsignale
4. Dokumentiere Fachterminologie und Sprachmuster
5. Alle Insights MÜSSEN durch Zitate belegt sein

WICHTIGE REGELN:
- Verwende IMMER die exakten Worte des Kunden
- Jede Erkenntnis braucht mindestens ein Zitat
- Kategorisiere logisch und konsistent
- Behalte den authentischen Ton bei
- Antworte auf DEUTSCH"""

    ANALYSIS_PROMPT = """Analysiere die folgenden Lead-Aussagen aus {meeting_count} Meeting(s).

MEETING-KONTEXT:
{meeting_context}

LEAD-AUSSAGEN (nur Kunden, nicht Host):
{lead_statements}

Erstelle eine strukturierte JSON-Analyse mit folgenden Abschnitten:

{{
    "customer_profiles": [
        {{
            "company_name": "Name falls erwähnt",
            "industry": "Branche",
            "company_size": "Größe falls erwähnt",
            "decision_maker_role": "Rolle des Entscheiders",
            "purchasing_authority": "Kaufentscheidungskompetenz",
            "business_context": "Geschäftskontext",
            "current_solutions": ["Aktuelle Lösungen"],
            "budget_indicators": "Budget-Hinweise",
            "timeline_urgency": "Dringlichkeit",
            "supporting_quotes": [{{"quote": "Direktes Zitat", "context": "Kontext"}}]
        }}
    ],
    "pain_points": [
        {{
            "category": "Kategorie (Technisch/Prozess/Kosten/Skalierung/Support)",
            "description": "Beschreibung des Problems",
            "direct_quote": "Exaktes Zitat des Kunden",
            "speaker": "Name des Sprechers",
            "impact_level": "Hoch/Mittel/Niedrig",
            "context": "Situationskontext",
            "desired_outcome": "Gewünschtes Ergebnis in Kundenworten",
            "impact_statement": "Auswirkung laut Kunde"
        }}
    ],
    "questions": [
        {{
            "text": "Die gestellte Frage",
            "speaker": "Name",
            "category": "Kategorie (Preis/Funktionen/Integration/Support/Sicherheit)",
            "underlying_concern": "Zugrundeliegende Sorge",
            "context": "Kontext der Frage"
        }}
    ],
    "objections": [
        {{
            "objection_text": "Der Einwand",
            "direct_quote": "Exaktes Zitat",
            "speaker": "Name",
            "emotional_undertone": "Emotionale Färbung",
            "root_cause": "Ursache des Einwands",
            "resolution_pathway": "Lösungsweg",
            "conversion_trigger": "Was würde überzeugen"
        }}
    ],
    "language_patterns": [
        {{
            "category": "industry_term/emotional/power_word/metaphor",
            "phrase": "Der genaue Ausdruck",
            "context": "Verwendungskontext",
            "speaker": "Name"
        }}
    ],
    "value_propositions": [
        {{
            "customer_need": "Kundenbedürfnis (Zitat)",
            "solution_alignment": "Wie {company_name} hilft",
            "benefit_statement": "Nutzenaussage in Kundensprache"
        }}
    ],
    "marketing_recommendations": [
        {{
            "section": "Abschnitt (z.B. Homepage, Landing Page)",
            "customer_quote": "Unterstützendes Zitat",
            "recommended_message": "Empfohlene Botschaft"
        }}
    ],
    "messaging_guidelines": [
        {{
            "effective_term": "Wirkungsvoller Begriff",
            "customer_quote": "Zitat als Beleg",
            "usage_recommendation": "Anwendungsempfehlung"
        }}
    ],
    "conversion_triggers": ["Liste der identifizierten Kaufauslöser mit Zitaten"]
}}

WICHTIG:
- Nur echte, im Transkript vorkommende Zitate verwenden
- Keine erfundenen oder paraphrasierten Aussagen
- Bei Unsicherheit lieber weglassen als erfinden
- Alle Ausgaben auf DEUTSCH"""

    def __init__(self):
        """Initialisiert den AI Analyzer."""
        self.provider = settings.ai_provider
        self.company_name = settings.company_name

        if self.provider == "anthropic":
            self._init_anthropic()
        else:
            self._init_openai()

    def _init_anthropic(self):
        """Initialisiert den Anthropic Client."""
        try:
            import anthropic
            self.client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            self.model = "claude-sonnet-4-20250514"
        except ImportError:
            raise ImportError("anthropic package nicht installiert. Bitte 'pip install anthropic' ausführen.")

    def _init_openai(self):
        """Initialisiert den OpenAI Client."""
        try:
            import openai
            self.client = openai.OpenAI(api_key=settings.openai_api_key)
            self.model = "gpt-4-turbo-preview"
        except ImportError:
            raise ImportError("openai package nicht installiert. Bitte 'pip install openai' ausführen.")

    def _call_ai(self, system_prompt: str, user_prompt: str) -> str:
        """Ruft die KI-API auf."""
        if self.provider == "anthropic":
            response = self.client.messages.create(
                model=self.model,
                max_tokens=8000,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}]
            )
            return response.content[0].text
        else:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=8000,
                temperature=0.3
            )
            return response.choices[0].message.content

    def analyze_meetings(
        self,
        meetings: List[Meeting],
        host_identifiers: List[str] = None
    ) -> AnalysisResult:
        """
        Analysiert mehrere Meetings und erstellt umfassende Insights.

        Args:
            meetings: Liste von Meeting-Objekten
            host_identifiers: Namen/E-Mails der Hosts zum Ausfiltern

        Returns:
            AnalysisResult mit allen Deliverables
        """
        if not meetings:
            return AnalysisResult()

        # Sammle alle Lead-Aussagen
        all_lead_statements = []
        meeting_contexts = []

        for meeting in meetings:
            lead_statements = meeting.get_lead_statements(host_identifiers)
            all_lead_statements.extend(lead_statements)

            meeting_contexts.append({
                "title": meeting.title,
                "date": meeting.date.strftime("%d.%m.%Y"),
                "duration": f"{meeting.duration} Minuten",
                "participants": [s.name for s in meeting.speakers]
            })

        if not all_lead_statements:
            return AnalysisResult(
                meetings_analyzed=len(meetings),
                total_lead_statements=0
            )

        # Formatiere Aussagen für die KI
        formatted_statements = self._format_statements(all_lead_statements)
        meeting_context_str = json.dumps(meeting_contexts, ensure_ascii=False, indent=2)

        # Erstelle Prompts
        system_prompt = self.SYSTEM_PROMPT.format(company_name=self.company_name)
        user_prompt = self.ANALYSIS_PROMPT.format(
            meeting_count=len(meetings),
            meeting_context=meeting_context_str,
            lead_statements=formatted_statements,
            company_name=self.company_name
        )

        # Rufe KI auf
        try:
            response = self._call_ai(system_prompt, user_prompt)
            analysis_data = self._parse_response(response)
        except Exception as e:
            print(f"KI-Analyse Fehler: {e}")
            analysis_data = {}

        # Erstelle Ergebnis
        result = self._build_result(analysis_data, meetings, all_lead_statements)

        return result

    def _format_statements(self, statements: List[Sentence], max_chars: int = 50000) -> str:
        """Formatiert Aussagen für die KI-Analyse."""
        formatted = []
        total_chars = 0

        for stmt in statements:
            line = f"[{stmt.speaker_name}]: {stmt.text}"
            if total_chars + len(line) > max_chars:
                break
            formatted.append(line)
            total_chars += len(line)

        return "\n".join(formatted)

    def _parse_response(self, response: str) -> Dict:
        """Parst die KI-Antwort als JSON."""
        # Finde JSON im Response
        try:
            # Versuche direktes JSON-Parsing
            return json.loads(response)
        except json.JSONDecodeError:
            pass

        # Suche nach JSON-Block
        import re
        json_match = re.search(r'\{[\s\S]*\}', response)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        return {}

    def _build_result(
        self,
        analysis_data: Dict,
        meetings: List[Meeting],
        lead_statements: List[Sentence]
    ) -> AnalysisResult:
        """Baut das AnalysisResult aus den Daten."""
        result = AnalysisResult(
            meetings_analyzed=len(meetings),
            total_lead_statements=len(lead_statements)
        )

        # Customer Profiles
        for cp in analysis_data.get("customer_profiles", []):
            result.customer_profiles.append(CustomerProfile(
                company_name=cp.get("company_name", ""),
                industry=cp.get("industry", ""),
                company_size=cp.get("company_size", ""),
                decision_maker_role=cp.get("decision_maker_role", ""),
                purchasing_authority=cp.get("purchasing_authority", ""),
                business_context=cp.get("business_context", ""),
                current_solutions=cp.get("current_solutions", []),
                budget_indicators=cp.get("budget_indicators", ""),
                timeline_urgency=cp.get("timeline_urgency", ""),
                supporting_quotes=cp.get("supporting_quotes", [])
            ))

        # Pain Points
        for pp in analysis_data.get("pain_points", []):
            result.pain_points.append(PainPoint(
                category=pp.get("category", "Sonstiges"),
                description=pp.get("description", ""),
                direct_quote=pp.get("direct_quote", ""),
                speaker=pp.get("speaker", ""),
                impact_level=pp.get("impact_level", "Mittel"),
                context=pp.get("context", ""),
                desired_outcome=pp.get("desired_outcome", ""),
                impact_statement=pp.get("impact_statement", "")
            ))

        # Questions
        for q in analysis_data.get("questions", []):
            result.questions.append(Question(
                text=q.get("text", ""),
                speaker=q.get("speaker", ""),
                category=q.get("category", "Allgemein"),
                underlying_concern=q.get("underlying_concern", ""),
                context=q.get("context", "")
            ))

        # Objections
        for obj in analysis_data.get("objections", []):
            result.objections.append(Objection(
                objection_text=obj.get("objection_text", ""),
                direct_quote=obj.get("direct_quote", ""),
                speaker=obj.get("speaker", ""),
                emotional_undertone=obj.get("emotional_undertone", ""),
                root_cause=obj.get("root_cause", ""),
                resolution_pathway=obj.get("resolution_pathway", ""),
                conversion_trigger=obj.get("conversion_trigger", "")
            ))

        # Language Patterns
        for lp in analysis_data.get("language_patterns", []):
            result.language_patterns.append(LanguagePattern(
                category=lp.get("category", ""),
                phrase=lp.get("phrase", ""),
                context=lp.get("context", ""),
                speaker=lp.get("speaker", "")
            ))

        # Aggregierte Daten
        result.value_propositions = analysis_data.get("value_propositions", [])
        result.marketing_recommendations = analysis_data.get("marketing_recommendations", [])
        result.messaging_guidelines = analysis_data.get("messaging_guidelines", [])
        result.conversion_triggers = analysis_data.get("conversion_triggers", [])

        # Pain Point Kategorien zählen
        for pp in result.pain_points:
            cat = pp.category
            result.top_pain_categories[cat] = result.top_pain_categories.get(cat, 0) + 1

        # Häufige Fragen sammeln
        result.common_questions = [q.text for q in result.questions[:10]]

        return result

    def generate_summary_report(self, result: AnalysisResult) -> str:
        """Generiert einen Zusammenfassungsbericht."""
        if self.provider == "anthropic":
            return self._generate_summary_anthropic(result)
        else:
            return self._generate_summary_openai(result)

    def _generate_summary_anthropic(self, result: AnalysisResult) -> str:
        """Generiert Zusammenfassung mit Claude."""
        prompt = f"""Erstelle eine Executive Summary auf Deutsch für folgende Analyseergebnisse:

Analysierte Meetings: {result.meetings_analyzed}
Lead-Aussagen: {result.total_lead_statements}

Top Pain Points: {json.dumps([asdict(pp) for pp in result.pain_points[:5]], ensure_ascii=False)}
Häufige Fragen: {result.common_questions}
Einwände: {json.dumps([asdict(obj) for obj in result.objections[:5]], ensure_ascii=False)}
Conversion Triggers: {result.conversion_triggers}

Erstelle eine prägnante Zusammenfassung (max 500 Wörter) mit:
1. Kernerkenntnisse
2. Top 3 Pain Points mit Zitaten
3. Wichtigste Handlungsempfehlungen
4. Dringende nächste Schritte"""

        system = "Du bist ein Sales-Stratege, der Analyseergebnisse zusammenfasst. Antworte auf Deutsch."
        return self._call_ai(system, prompt)

    def _generate_summary_openai(self, result: AnalysisResult) -> str:
        """Generiert Zusammenfassung mit GPT."""
        return self._generate_summary_anthropic(result)  # Gleiche Logik
