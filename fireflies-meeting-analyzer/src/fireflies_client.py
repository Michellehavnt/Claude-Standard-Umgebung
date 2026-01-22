"""
Fireflies.ai API Client
Implementiert GraphQL-Abfragen für Meeting-Transkripte.
"""

import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import httpx
from dataclasses import dataclass, field

from .config import settings, TIME_PERIODS


@dataclass
class Speaker:
    """Repräsentiert einen Meeting-Teilnehmer."""
    id: str
    name: str
    email: Optional[str] = None
    duration: float = 0
    word_count: int = 0
    is_host: bool = False


@dataclass
class Sentence:
    """Repräsentiert einen Satz aus dem Transkript."""
    index: int
    text: str
    speaker_id: str
    speaker_name: str
    start_time: float
    end_time: float
    raw_text: Optional[str] = None


@dataclass
class MeetingSummary:
    """Zusammenfassung eines Meetings."""
    keywords: List[str] = field(default_factory=list)
    action_items: List[str] = field(default_factory=list)
    outline: List[str] = field(default_factory=list)
    meeting_type: Optional[str] = None
    questions: List[str] = field(default_factory=list)


@dataclass
class Meeting:
    """Vollständige Meeting-Daten."""
    id: str
    title: str
    date: datetime
    duration: int  # in Minuten
    host_email: Optional[str]
    organizer_email: Optional[str]
    speakers: List[Speaker]
    sentences: List[Sentence]
    summary: MeetingSummary
    transcript_url: Optional[str] = None
    participants: List[str] = field(default_factory=list)

    def get_lead_statements(self, host_identifiers: List[str] = None) -> List[Sentence]:
        """
        Extrahiert nur die Aussagen der Leads (nicht des Hosts).

        Args:
            host_identifiers: Liste von Namen/IDs die als Host identifiziert werden sollen
        """
        if host_identifiers is None:
            host_identifiers = []

        # Erweitere Host-Identifier um bekannte Host-Marker
        host_markers = set(host_identifiers)
        if self.host_email:
            host_markers.add(self.host_email.lower())
        if self.organizer_email:
            host_markers.add(self.organizer_email.lower())

        # Identifiziere Host-Speaker
        host_speaker_ids = set()
        for speaker in self.speakers:
            speaker_lower = speaker.name.lower() if speaker.name else ""
            email_lower = speaker.email.lower() if speaker.email else ""

            # Prüfe ob Speaker ein Host ist
            if speaker.is_host:
                host_speaker_ids.add(speaker.id)
            elif any(marker in speaker_lower or marker in email_lower
                     for marker in host_markers if marker):
                host_speaker_ids.add(speaker.id)

        # Filtere Lead-Aussagen
        lead_statements = [
            sentence for sentence in self.sentences
            if sentence.speaker_id not in host_speaker_ids
        ]

        return lead_statements

    def get_lead_questions(self, host_identifiers: List[str] = None) -> List[Sentence]:
        """Extrahiert Fragen von Leads."""
        lead_statements = self.get_lead_statements(host_identifiers)
        return [s for s in lead_statements if "?" in s.text]


class FirefliesClient:
    """Client für die Fireflies.ai GraphQL API."""

    # GraphQL Query für Liste aller Transkripte
    TRANSCRIPTS_QUERY = """
    query Transcripts($date: Float, $limit: Int, $skip: Int, $hostEmail: String) {
        transcripts(date: $date, limit: $limit, skip: $skip, host_email: $hostEmail) {
            id
            title
            date
            duration
            host_email
            organizer_email
            transcript_url
            participants
        }
    }
    """

    # GraphQL Query für einzelnes Transkript mit vollständigen Details
    TRANSCRIPT_DETAIL_QUERY = """
    query Transcript($transcriptId: String!) {
        transcript(id: $transcriptId) {
            id
            title
            date
            duration
            host_email
            organizer_email
            transcript_url
            participants
            speakers {
                id
                name
                email
                duration
                word_count
            }
            sentences {
                index
                text
                raw_text
                speaker_id
                speaker_name
                start_time
                end_time
            }
            summary {
                keywords
                action_items
                outline
                meeting_type
            }
            ai_filters {
                questions {
                    text
                    speaker_name
                }
            }
        }
    }
    """

    def __init__(self, api_key: str = None):
        """
        Initialisiert den Fireflies Client.

        Args:
            api_key: Fireflies API Key (optional, wird aus Settings geladen)
        """
        self.api_key = api_key or settings.fireflies_api_key
        self.api_url = settings.fireflies_api_url
        self.client = httpx.Client(timeout=60.0)

    def _make_request(self, query: str, variables: Dict = None) -> Dict:
        """
        Führt eine GraphQL-Anfrage aus.

        Args:
            query: GraphQL Query
            variables: Query-Variablen

        Returns:
            API-Antwort als Dictionary
        """
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        payload = {"query": query}
        if variables:
            payload["variables"] = variables

        response = self.client.post(
            self.api_url,
            json=payload,
            headers=headers
        )

        if response.status_code != 200:
            raise FirefliesAPIError(
                f"API-Fehler: {response.status_code} - {response.text}"
            )

        data = response.json()

        if "errors" in data:
            raise FirefliesAPIError(f"GraphQL-Fehler: {data['errors']}")

        return data.get("data", {})

    def get_transcripts(
        self,
        time_period: str = None,
        host_email: str = None,
        from_date: datetime = None,
        limit: int = None
    ) -> List[Dict]:
        """
        Ruft eine Liste von Meeting-Transkripten ab.

        Args:
            time_period: Zeitraum-Key aus TIME_PERIODS
            host_email: Optional: Nur Meetings dieses Hosts
            from_date: Optional: Meetings ab diesem Datum
            limit: Maximale Anzahl Meetings

        Returns:
            Liste von Meeting-Metadaten
        """
        variables = {
            "limit": limit or settings.max_meetings_per_request
        }

        # Zeitraum-Filter
        if time_period and time_period in TIME_PERIODS:
            days = TIME_PERIODS[time_period]["days"]
            if days == 0:
                # Heute: Beginn des aktuellen Tages
                from_date = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            else:
                from_date = datetime.now() - timedelta(days=days)

        if from_date:
            # Fireflies erwartet Millisekunden
            variables["date"] = int(from_date.timestamp() * 1000)

        if host_email:
            variables["hostEmail"] = host_email

        all_transcripts = []
        skip = 0

        # Paginierung
        while True:
            variables["skip"] = skip
            data = self._make_request(self.TRANSCRIPTS_QUERY, variables)
            transcripts = data.get("transcripts", [])

            if not transcripts:
                break

            all_transcripts.extend(transcripts)

            if len(transcripts) < variables["limit"]:
                break

            skip += len(transcripts)

            # Rate Limiting
            time.sleep(0.5)

        return all_transcripts

    def get_transcript_detail(self, transcript_id: str) -> Meeting:
        """
        Ruft vollständige Details eines Transkripts ab.

        Args:
            transcript_id: ID des Transkripts

        Returns:
            Meeting-Objekt mit allen Details
        """
        variables = {"transcriptId": transcript_id}
        data = self._make_request(self.TRANSCRIPT_DETAIL_QUERY, variables)
        transcript = data.get("transcript", {})

        if not transcript:
            raise FirefliesAPIError(f"Transkript nicht gefunden: {transcript_id}")

        return self._parse_transcript(transcript)

    def _parse_transcript(self, data: Dict) -> Meeting:
        """Parst die API-Antwort in ein Meeting-Objekt."""

        # Speakers parsen
        speakers = []
        for sp in data.get("speakers", []):
            speakers.append(Speaker(
                id=sp.get("id", ""),
                name=sp.get("name", "Unknown"),
                email=sp.get("email"),
                duration=sp.get("duration", 0),
                word_count=sp.get("word_count", 0)
            ))

        # Sentences parsen
        sentences = []
        for sent in data.get("sentences", []):
            sentences.append(Sentence(
                index=sent.get("index", 0),
                text=sent.get("text", ""),
                speaker_id=sent.get("speaker_id", ""),
                speaker_name=sent.get("speaker_name", "Unknown"),
                start_time=sent.get("start_time", 0),
                end_time=sent.get("end_time", 0),
                raw_text=sent.get("raw_text")
            ))

        # Summary parsen
        summary_data = data.get("summary", {}) or {}
        ai_filters = data.get("ai_filters", {}) or {}
        questions_data = ai_filters.get("questions", []) or []

        summary = MeetingSummary(
            keywords=summary_data.get("keywords", []) or [],
            action_items=summary_data.get("action_items", []) or [],
            outline=summary_data.get("outline", []) or [],
            meeting_type=summary_data.get("meeting_type"),
            questions=[q.get("text", "") for q in questions_data]
        )

        # Datum parsen
        date_value = data.get("date")
        if isinstance(date_value, (int, float)):
            # Millisekunden zu datetime
            meeting_date = datetime.fromtimestamp(date_value / 1000)
        elif isinstance(date_value, str):
            meeting_date = datetime.fromisoformat(date_value.replace("Z", "+00:00"))
        else:
            meeting_date = datetime.now()

        return Meeting(
            id=data.get("id", ""),
            title=data.get("title", "Untitled Meeting"),
            date=meeting_date,
            duration=data.get("duration", 0),
            host_email=data.get("host_email"),
            organizer_email=data.get("organizer_email"),
            speakers=speakers,
            sentences=sentences,
            summary=summary,
            transcript_url=data.get("transcript_url"),
            participants=data.get("participants", []) or []
        )

    def get_all_hosts(self, time_period: str = "letzte_3_monate") -> List[str]:
        """
        Ermittelt alle eindeutigen Hosts im Zeitraum.

        Args:
            time_period: Zeitraum für die Suche

        Returns:
            Liste eindeutiger Host-E-Mails
        """
        transcripts = self.get_transcripts(time_period=time_period)
        hosts = set()

        for t in transcripts:
            if t.get("host_email"):
                hosts.add(t["host_email"])
            if t.get("organizer_email"):
                hosts.add(t["organizer_email"])

        return sorted(list(hosts))

    def close(self):
        """Schließt die HTTP-Verbindung."""
        self.client.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


class FirefliesAPIError(Exception):
    """Exception für Fireflies API Fehler."""
    pass
