# Data contract (schema_version 1)

The pipeline (`server/pipeline/`) writes four JSON files; the game only reads `world.json`.
Every file starts with `"schema_version": 1` and `"as_of"` (ISO time of the run). Keys and
values are English; text written for people (inscriptions, cause of death, mourner comments,
README excerpts, commit messages) stays in whatever language it was written in.

| File | Content |
| --- | --- |
| `world.json` | `{ schema_version, as_of, repos: [...] }`, one entry per repo, ready for the game |
| `raw.json` | `{ schema_version, as_of, org, repos: [...] }`, raw data from GitHub (not deployed, may contain commit messages and READMEs) |
| `epitaphs.json` | `{ schema_version, as_of, repos: { <name>: {...} } }`, inscription cache |
| `live.json` | `{ schema_version, as_of, live: { <name>: {...} } }`, result of the live check |

The classification file of an instance (`classification.json`, without `schema_version`) maps
repo names to `{ category, client, successor, buried, live_url }`.

## world.json, one repo

| Key | Meaning |
| --- | --- |
| `name`, `description`, `language` | from GitHub |
| `category` | `product`, `client`, `experiment` or `internal` |
| `client`, `successor` | display name of the client, name of the successor repo (or null) |
| `created_at`, `first_commit`, `last_commit`, `last_push` | ISO times |
| `days_since_push`, `commits`, `files`, `authors`, `last_words` | numbers, authors with commit counts, last commit message |
| `archived` | archived on GitHub |
| `live` | `{ url, ok }` of the live check, or null |
| `state` | see below |
| `hospice_days_left` | days until a repo in the hospice counts as dead |
| `grave_tier` | `cross`, `stone`, `marble` or `mausoleum` |
| `resurrected_at` | first commit after a long pause, or null |
| `commits_per_month` | `{ "YYYY-MM": count }` |
| `inscription`, `cause_of_death`, `npc: { who, text }` | from `epitaphs.json` |

States:

| State | Meaning |
| --- | --- |
| `alive` | pushed recently |
| `sleeping` | no recent push, but the site is reachable |
| `client_active` | client project, pushed recently |
| `delivered` | client project, finished |
| `hospice` | no push for a while, not dead yet |
| `dead` | no push for `thresholds.deadDays`, or buried by hand |
| `buried` | archived without a successor |
| `ancestor` | archived, lives on in its successor |

## epitaphs.json, one repo

`inscription`, `cause_of_death`, `npc: { who, text }`, `hash` (null: no valid version yet),
`state`, `generated_at`, `source` (`facts` for plain inscriptions without a model), the commit state
`commits`, `last_commit`, `head_sha` (a new inscription is only written when it changes), and
`empty_fields` when the model left fields invalid.

## live.json, one repo

`url`, `status`, `server`, `title`, `final_url`, `ok`, `reason`.

## Before schema_version 1

Instances that started with the German format can convert their files once with a script like
the one used for the first instance; the full mapping is below. File names changed as well:
`welt.json` -> `world.json`, `roh.json` -> `raw.json`, `grabschriften.json` -> `epitaphs.json`,
`beispiel.json` -> `example.json`; `live.json` keeps its name.

<!-- german-check: off (the old German keys and values, listed on purpose) -->

### Keys

| before | v1 |
| --- | --- |
| `stand` | `as_of` |
| `erzeugt` | `generated_at` |
| `beispiel` | `example` |
| `beschreibung` | `description` |
| `sprache` | `language` |
| `erstellt` | `created_at` |
| `letzter_push` | `last_push` |
| `archiviert` | `archived` |
| `erster_commit` | `first_commit` |
| `letzter_commit` | `last_commit` |
| `letzte_worte` | `last_words` |
| `commit_daten` | `commit_dates` |
| `commits_je_monat` | `commits_per_month` |
| `laengste_pause_tage` | `longest_pause_days` |
| `aktive_wochen` | `active_weeks` |
| `autoren` | `authors` |
| `dateien` | `files` |
| `top_ordner` | `top_folders` |
| `endungen` | `extensions` |
| `endung` | `extension` |
| `anzahl` | `count` |
| `letzte_commits` | `recent_commits` |
| `quelle` | `source` |
| `autoren_gruppen` | `author_groups` |
| `roh_version` | `raw_version` |
| `auferstanden_am` | `resurrected_at` |
| `kategorie` | `category` |
| `kunde` | `client` |
| `nachfolger` | `successor` |
| `begraben` | `buried` |
| `zustand` | `state` |
| `grabstufe` | `grave_tier` |
| `tage_ohne_push` | `days_since_push` |
| `hospiz_tage_rest` | `hospice_days_left` |
| `inschrift` | `inscription` |
| `todesursache` | `cause_of_death` |
| `wer` | `who` |
| `leere_felder` | `empty_fields` |
| `endurl` | `final_url` |
| `titel` | `title` |
| `grund` | `reason` |

### Values of `state`

| before | v1 |
| --- | --- |
| `lebt` | `alive` |
| `schlaeft` | `sleeping` |
| `kunde_aktiv` | `client_active` |
| `ausgeliefert` | `delivered` |
| `hospiz` | `hospice` |
| `tot` | `dead` |
| `beerdigt` | `buried` |
| `ahne` | `ancestor` |

### Values of `category`

| before | v1 |
| --- | --- |
| `produkt` | `product` |
| `kunde` | `client` |
| `intern` | `internal` |

### Values of `grave_tier`

| before | v1 |
| --- | --- |
| `kreuz` | `cross` |
| `stein` | `stone` |
| `marmor` | `marble` |

### Values of `source`

| before | v1 |
| --- | --- |
| `leer` | `empty` |
| `fakten` | `facts` |

### Values of `extension`

| before | v1 |
| --- | --- |
| `(ohne)` | `(none)` |

### Configuration: look

| before | v1 |
| --- | --- |
| `haut` | `skin` |
| `haar` | `hair` |
| `frisur` | `hairstyle` |
| `bart` | `beard` |
| `brille` | `glasses` |
| `oben` | `top` |
| `farbe` | `color` |
| `hemd` | `shirt` |
| `tuch` | `scarf` |
| `krawatte` | `tie` |
| `hose` | `trousers` |
| `schuhe` | `shoes` |
| `kurz` | `short` |
| `lang` | `long` |
| `locken` | `curls` |
| `lockenoben` | `curlytop` |
| `nachhinten` | `slicked` |
| `dutt` | `bun` |
| `seite` | `side` |
| `zopf` | `braid` |
| `kurzlang` | `longbob` |
| `struppig` | `shaggy` |
| `stoppel` | `stubble` |
| `voll` | `full` |
| `sakko` | `blazer` |
| `jacke` | `jacket` |
| `pullover` | `sweater` |
| `weste` | `vest` |
| `mantel` | `coat` |
| `zerrissen` | `torn` |
| `telefon` | `phone` |
| `brief` | `letter` |
| `rechner` | `calculator` |
| `mappe` | `folder` |
| `schirm` | `umbrella` |

<!-- german-check: on -->
