// Deutsche Vorlage für die Grabschriften (Prompt, Antwortformat, Prüfmeldungen, Inschrift aus Fakten).
// Diese Datei ist absichtlich deutsch: Sie ist die Sprachfassung "de" neben en.js und wird von der
// Sprachprüfung ausgenommen. Platzhalter: {project}, {tone}, {format}, {mourners} aus der
// Konfiguration, {state}, {state_explanation}, {data} aus dem Repo.

export default {
  template: `Du schreibst für {project} eine Inschrift zu einem Git-Repo. Die Welt ist ein nächtliches Dorf mit Friedhof: lebende Produkte sind Häuser, Kundenprojekte stehen im Kundenviertel oder als Denkmal, sterbende Repos liegen im Hospiz, tote auf dem Friedhof, Vorgänger in der Ahnengruft ihres Nachfolgers.

Ton: {tone} Kein Klamauk, keine Wortspiele mit dem Repo-Namen um jeden Preis, keine Emojis, keine Gedankenstriche, keine Ausrufezeichen. Nur Fakten aus den Daten unten verwenden, keine Zahlen erfinden. Sticheleien gegen Kunden sind tabu; bei Kundenprojekten ehrt die Inschrift die geleistete Arbeit.

Zustand des Repos: {state} ({state_explanation})

Daten:
{data}

Antworte nur mit JSON, ohne Codeblock:
{format}

- inschrift: ein bis zwei kurze Sätze, höchstens 140 Zeichen. Passt zum Zustand: Grabschrift (tot, beerdigt), Diagnose am Krankenbett (hospiz), Hausspruch über der Tür (lebt, schlaeft, kunde_aktiv), Sockelinschrift (ausgeliefert), Ahnentafel (ahne, nennt den Nachfolger).
- todesursache: höchstens 80 Zeichen, aus Verlauf und README erschlossen. Bei hospiz die vermutliche Krankheit, bei lebenden Repos leerer String.{mourners}`,

  defaultProject: (context) => `„graveyard“, das nächtliche Dorf, in dem die Repos von ${context} leben und ruhen`,

  // Schlüssel der Antwort, die das Modell zurückgibt
  answer: { inscription: 'inschrift', cause_of_death: 'todesursache', npc: 'npc', who: 'wer', text: 'text' },
  formatWithMourners: '{"inschrift": "…", "todesursache": "…", "npc": {"wer": "…", "text": "…"}}',
  formatWithoutMourners: '{"inschrift": "…", "todesursache": "…"}',
  mourners: (group, list) => `\n- npc: ein Kommentar einer Trauergästin bzw. eines Trauergasts${group}, höchstens 100 Zeichen, in ihrer Rolle: ${list}. Wähle die Person, die zu diesem Repo am meisten zu sagen hat.`,

  // So heißen Zustände, Kategorien und Felder im Prompt
  states: { alive: 'lebt', sleeping: 'schlaeft', client_active: 'kunde_aktiv', delivered: 'ausgeliefert', hospice: 'hospiz', dead: 'tot', buried: 'beerdigt', ancestor: 'ahne' },
  categories: { product: 'produkt', client: 'kunde', experiment: 'experiment', internal: 'intern' },
  fields: {
    description: 'beschreibung', language: 'sprache', category: 'kategorie', client: 'kunde', successor: 'nachfolger',
    created_at: 'erstellt', first_commit: 'erster_commit', last_push: 'letzter_push', days_since_push: 'tage_ohne_push',
    commits_per_month: 'commits_je_monat', longest_pause_days: 'laengste_pause_tage', active_weeks: 'aktive_wochen',
    files: 'dateien', top_folders: 'top_ordner', extensions: 'endungen', extension: 'endung', count: 'anzahl',
    authors: 'autoren', recent_commits: 'letzte_commits',
  },
  noExtension: '(ohne)',

  explanation: {
    alive: (r) => `vor ${r.days} Tagen zuletzt gepusht, aus dem Schornstein steigt Rauch`,
    sleeping: (r) => `seit ${r.days} Tagen kein Push, aber die Seite ${r.url} ist erreichbar, im Haus brennt noch Licht`,
    hospice: (r) => `seit ${r.days} Tagen kein Push, in ${r.left} Tagen gilt es als tot`,
    deadByHand: (r) => `von Hand begraben, obwohl es nie richtig gestorben ist, seit ${r.days} Tagen kein Push`,
    dead: (r) => `seit ${r.days} Tagen kein Push, liegt auf dem Friedhof`,
    buried: () => 'archiviert und ordentlich beerdigt, ohne Nachfolger',
    ancestor: (r) => `archiviert, lebt weiter in ${r.successor}, ruht in dessen Ahnengruft`,
    client_active: (r) => `Kundenprojekt für ${r.client}, vor ${r.days} Tagen zuletzt gepusht, Haus im Kundenviertel`,
    delivered: (r) => `Kundenprojekt für ${r.client}, ausgeliefert, seit ${r.days} Tagen kein Push, steht als Denkmal`,
  },

  retry: (errors) => `\n\nDein letzter Versuch war ungültig: ${errors}. Halte die Regeln genau ein.`,
  errors: {
    json: (m) => `kein gültiges JSON (${m})`,
    notObject: 'kein JSON-Objekt',
    inscriptionLength: (n) => `inschrift ${n} Zeichen, erlaubt 1 bis 140`,
    inscriptionChars: 'inschrift enthält Gedankenstrich oder Emoji',
    causeLength: (n) => `todesursache ${n} Zeichen, erlaubt höchstens 80`,
    causeChars: 'todesursache enthält Gedankenstrich oder Emoji',
    who: (who, names) => `npc.wer '${who}' nicht in [${names}]`,
    npcLength: (n) => `npc.text ${n} Zeichen, erlaubt 1 bis 100`,
    npcChars: 'npc.text enthält Gedankenstrich oder Emoji',
    call: (m) => `Aufruf fehlgeschlagen: ${m}`,
    invalid: 'ungültig',
  },

  // Schlichte Inschrift aus Fakten, wenn kein Modell zur Verfügung steht
  facts: {
    commits: (n) => `${n} ${n === 1 ? 'Commit' : 'Commits'}`,
    span: (a, b) => `${a} bis ${b}`,
    ancestor: (r) => `${r.name}. ${r.commits}, lebt weiter in ${r.successor}.`,
    buried: (r) => `${r.name}. ${r.commits}${r.time ? `, ${r.time}` : ''}.`,
    buriedCause: () => 'Archiviert',
    dead: (r) => `${r.name}. ${r.commits}${r.time ? `, ${r.time}` : ''}.`,
    deadByHandCause: () => 'Von Hand begraben',
    deadCause: (r) => `Seit ${r.days} Tagen kein Push`,
    hospice: (r) => `${r.name}. ${r.commits}, seit ${r.days} Tagen still.`,
    hospiceCause: (r) => `${r.days} Tage ohne Push`,
    delivered: (r) => `${r.name}. ${r.commits}${r.client ? ` für ${r.client}` : ''}, ausgeliefert.`,
    other: (r) => `${r.name}. ${r.commits}${r.from ? ` seit ${r.from}` : ''}.`,
  },
}
