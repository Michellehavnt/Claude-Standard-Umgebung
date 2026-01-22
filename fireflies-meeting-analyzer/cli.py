#!/usr/bin/env python3
"""
Fireflies Meeting Analyzer - CLI Interface
Kommandozeilen-Tool zur Analyse von Meeting-Transkripten.
"""

import sys
from pathlib import Path
from datetime import datetime

import typer
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.panel import Panel
from rich.markdown import Markdown

sys.path.insert(0, str(Path(__file__).parent))

from src.config import settings, TIME_PERIODS
from src.fireflies_client import FirefliesClient, FirefliesAPIError
from src.ai_analyzer import AIAnalyzer
from src.exporter import ReportExporter

app = typer.Typer(
    name="fireflies-analyzer",
    help="Analysiert Meeting-Transkripte von Fireflies.ai"
)
console = Console()


@app.command()
def analyze(
    zeitraum: str = typer.Option(
        "letzte_woche",
        "--zeitraum", "-z",
        help="Zeitraum: heute, letzte_woche, letzter_monat, letzte_3_monate"
    ),
    host: str = typer.Option(
        None,
        "--host", "-h",
        help="Filter nach Host-E-Mail"
    ),
    exclude_hosts: str = typer.Option(
        "",
        "--exclude", "-e",
        help="Host-Namen zum Ausschließen (kommasepariert)"
    ),
    export_format: str = typer.Option(
        "markdown",
        "--format", "-f",
        help="Export-Format: markdown, excel, json"
    ),
    output: str = typer.Option(
        None,
        "--output", "-o",
        help="Output-Dateiname"
    )
):
    """
    Analysiert Meetings und erstellt einen Report.
    """
    # Konfiguration prüfen
    status = settings.validate_config()
    if not status["ready"]:
        console.print("[red]Konfiguration unvollständig:[/red]")
        for msg in status["messages"]:
            console.print(f"  - {msg}")
        raise typer.Exit(1)

    # Zeitraum validieren
    if zeitraum not in TIME_PERIODS:
        console.print(f"[red]Ungültiger Zeitraum: {zeitraum}[/red]")
        console.print(f"Gültige Werte: {', '.join(TIME_PERIODS.keys())}")
        raise typer.Exit(1)

    host_identifiers = [h.strip() for h in exclude_hosts.split(",") if h.strip()]
    host_identifiers.extend(settings.host_emails)

    console.print(Panel(
        f"[bold]Fireflies Meeting Analyzer[/bold]\n\n"
        f"Zeitraum: {TIME_PERIODS[zeitraum]['label']}\n"
        f"Host-Filter: {host or 'Alle'}\n"
        f"Ausgeschlossene Hosts: {', '.join(host_identifiers) or 'Keine'}",
        title="Konfiguration"
    ))

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        # Meetings laden
        task = progress.add_task("Lade Meetings...", total=None)

        try:
            with FirefliesClient() as client:
                transcripts = client.get_transcripts(
                    time_period=zeitraum,
                    host_email=host
                )

                if not transcripts:
                    console.print("[yellow]Keine Meetings im gewählten Zeitraum gefunden.[/yellow]")
                    raise typer.Exit(0)

                progress.update(task, description=f"{len(transcripts)} Meetings gefunden. Lade Details...")

                meetings = []
                for t in transcripts:
                    try:
                        meeting = client.get_transcript_detail(t["id"])
                        meetings.append(meeting)
                    except Exception as e:
                        console.print(f"[yellow]Warnung: {e}[/yellow]")

        except FirefliesAPIError as e:
            console.print(f"[red]Fireflies API Fehler: {e}[/red]")
            raise typer.Exit(1)

        if not meetings:
            console.print("[red]Keine Meeting-Details konnten geladen werden.[/red]")
            raise typer.Exit(1)

        # Analyse
        progress.update(task, description="Analysiere Transkripte mit KI...")

        try:
            analyzer = AIAnalyzer()
            result = analyzer.analyze_meetings(meetings, host_identifiers)
        except Exception as e:
            console.print(f"[red]Analyse-Fehler: {e}[/red]")
            raise typer.Exit(1)

        progress.update(task, description="Exportiere Ergebnisse...")

        # Export
        exporter = ReportExporter()

        try:
            if export_format == "excel":
                filepath = exporter.export_to_excel(result, output)
            elif export_format == "json":
                filepath = exporter.export_to_json(result, output)
            else:
                filepath = exporter.export_to_markdown(result, output)
        except Exception as e:
            console.print(f"[red]Export-Fehler: {e}[/red]")
            raise typer.Exit(1)

    # Zusammenfassung anzeigen
    console.print()

    table = Table(title="Analyse-Ergebnis")
    table.add_column("Metrik", style="cyan")
    table.add_column("Wert", style="green")

    table.add_row("Analysierte Meetings", str(result.meetings_analyzed))
    table.add_row("Lead-Aussagen", str(result.total_lead_statements))
    table.add_row("Pain Points", str(len(result.pain_points)))
    table.add_row("Fragen", str(len(result.questions)))
    table.add_row("Einwände", str(len(result.objections)))
    table.add_row("Sprachmuster", str(len(result.language_patterns)))

    console.print(table)

    console.print(f"\n[green]Report exportiert: {filepath}[/green]")


@app.command()
def hosts(
    zeitraum: str = typer.Option(
        "letzte_3_monate",
        "--zeitraum", "-z",
        help="Zeitraum für Host-Suche"
    )
):
    """
    Listet alle verfügbaren Hosts auf.
    """
    status = settings.validate_config()
    if not status["fireflies_api"]:
        console.print("[red]Fireflies API Key fehlt.[/red]")
        raise typer.Exit(1)

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console
    ) as progress:
        task = progress.add_task("Lade Hosts...", total=None)

        try:
            with FirefliesClient() as client:
                hosts_list = client.get_all_hosts(zeitraum)
        except Exception as e:
            console.print(f"[red]Fehler: {e}[/red]")
            raise typer.Exit(1)

    if not hosts_list:
        console.print("[yellow]Keine Hosts gefunden.[/yellow]")
        raise typer.Exit(0)

    console.print(f"\n[bold]Verfügbare Hosts ({TIME_PERIODS[zeitraum]['label']}):[/bold]\n")
    for host in hosts_list:
        console.print(f"  - {host}")


@app.command()
def config():
    """
    Zeigt die aktuelle Konfiguration an.
    """
    status = settings.validate_config()

    table = Table(title="Konfiguration")
    table.add_column("Einstellung", style="cyan")
    table.add_column("Wert", style="green")
    table.add_column("Status")

    table.add_row(
        "Fireflies API",
        "Konfiguriert" if status["fireflies_api"] else "Fehlt",
        "[green]✓[/green]" if status["fireflies_api"] else "[red]✗[/red]"
    )

    table.add_row(
        "AI Provider",
        settings.ai_provider,
        "[green]✓[/green]" if status["ai_provider"] else "[red]✗[/red]"
    )

    table.add_row(
        "Firmenname",
        settings.company_name,
        "[green]✓[/green]"
    )

    table.add_row(
        "Export-Verzeichnis",
        settings.export_dir,
        "[green]✓[/green]"
    )

    table.add_row(
        "Host-Ausschlüsse",
        ", ".join(settings.host_emails) if settings.host_emails else "Keine",
        "[green]✓[/green]"
    )

    console.print(table)

    if not status["ready"]:
        console.print("\n[red]Konfiguration unvollständig![/red]")
        for msg in status["messages"]:
            console.print(f"  - {msg}")


if __name__ == "__main__":
    app()
