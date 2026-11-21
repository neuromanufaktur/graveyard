// English template for the epitaphs (prompt, answer format, check messages, inscription from facts).
// Placeholders: {project}, {tone}, {format}, {mourners} from the configuration,
// {state}, {state_explanation}, {data} from the repo.

export default {
  template: `You are writing an inscription for a Git repo for {project}. The world is a village with a graveyard at night: living products are houses, client projects stand in the client quarter or as a monument, dying repos lie in the hospice, dead ones in the graveyard, predecessors in the ancestral crypt of their successor.

Tone: {tone} No slapstick, no puns on the repo name at any cost, no emojis, no dashes, no exclamation marks. Only use facts from the data below, do not make up numbers. Teasing clients is off limits; for client projects the inscription honours the work that was done.

State of the repo: {state} ({state_explanation})

Data:
{data}

Answer with JSON only, without a code block:
{format}

- inscription: one or two short sentences, at most 140 characters. Fits the state: epitaph (dead, buried), bedside diagnosis (hospice), house motto above the door (alive, sleeping, client_active), plinth inscription (delivered), ancestral tablet (ancestor, names the successor).
- cause_of_death: at most 80 characters, inferred from history and README. For hospice the likely illness, for living repos an empty string.{mourners}`,

  defaultProject: (context) => `"graveyard", the night-time village where the repositories of ${context} live and rest`,

  // Keys of the answer the model returns
  answer: { inscription: 'inscription', cause_of_death: 'cause_of_death', npc: 'npc', who: 'who', text: 'text' },
  formatWithMourners: '{"inscription": "…", "cause_of_death": "…", "npc": {"who": "…", "text": "…"}}',
  formatWithoutMourners: '{"inscription": "…", "cause_of_death": "…"}',
  mourners: (group, list) => `\n- npc: a comment by one mourner${group}, at most 100 characters, in their role: ${list}. Pick the person who has the most to say about this repo.`,

  // Names of states, categories and fields in the prompt
  states: { alive: 'alive', sleeping: 'sleeping', client_active: 'client_active', delivered: 'delivered', hospice: 'hospice', dead: 'dead', buried: 'buried', ancestor: 'ancestor' },
  categories: { product: 'product', client: 'client', experiment: 'experiment', internal: 'internal' },
  fields: {
    description: 'description', language: 'language', category: 'category', client: 'client', successor: 'successor',
    created_at: 'created_at', first_commit: 'first_commit', last_push: 'last_push', days_since_push: 'days_since_push',
    commits_per_month: 'commits_per_month', longest_pause_days: 'longest_pause_days', active_weeks: 'active_weeks',
    files: 'files', top_folders: 'top_folders', extensions: 'extensions', extension: 'extension', count: 'count',
    authors: 'authors', recent_commits: 'recent_commits',
  },
  noExtension: '(none)',

  explanation: {
    alive: (r) => `last pushed ${r.days} days ago, smoke rises from the chimney`,
    sleeping: (r) => `no push for ${r.days} days, but the site ${r.url} is reachable, a light is still on in the house`,
    hospice: (r) => `no push for ${r.days} days, counts as dead in ${r.left} days`,
    deadByHand: (r) => `buried by hand although it never really died, no push for ${r.days} days`,
    dead: (r) => `no push for ${r.days} days, lies in the graveyard`,
    buried: () => 'archived and properly buried, without a successor',
    ancestor: (r) => `archived, lives on in ${r.successor}, rests in its ancestral crypt`,
    client_active: (r) => `client project for ${r.client}, last pushed ${r.days} days ago, house in the client quarter`,
    delivered: (r) => `client project for ${r.client}, delivered, no push for ${r.days} days, stands as a monument`,
  },

  retry: (errors) => `\n\nYour last attempt was invalid: ${errors}. Follow the rules exactly.`,
  errors: {
    json: (m) => `not valid JSON (${m})`,
    notObject: 'not a JSON object',
    inscriptionLength: (n) => `inscription ${n} characters, allowed 1 to 140`,
    inscriptionChars: 'inscription contains a dash or emoji',
    causeLength: (n) => `cause_of_death ${n} characters, allowed at most 80`,
    causeChars: 'cause_of_death contains a dash or emoji',
    who: (who, names) => `npc.who '${who}' not in [${names}]`,
    npcLength: (n) => `npc.text ${n} characters, allowed 1 to 100`,
    npcChars: 'npc.text contains a dash or emoji',
    call: (m) => `call failed: ${m}`,
    invalid: 'invalid',
  },

  // Plain inscription from facts when no model is available
  facts: {
    commits: (n) => `${n} ${n === 1 ? 'commit' : 'commits'}`,
    span: (a, b) => `${a} to ${b}`,
    ancestor: (r) => `${r.name}. ${r.commits}, lives on in ${r.successor}.`,
    buried: (r) => `${r.name}. ${r.commits}${r.time ? `, ${r.time}` : ''}.`,
    buriedCause: () => 'Archived',
    dead: (r) => `${r.name}. ${r.commits}${r.time ? `, ${r.time}` : ''}.`,
    deadByHandCause: () => 'Buried by hand',
    deadCause: (r) => `No push for ${r.days} days`,
    hospice: (r) => `${r.name}. ${r.commits}, quiet for ${r.days} days.`,
    hospiceCause: (r) => `${r.days} days without a push`,
    delivered: (r) => `${r.name}. ${r.commits}${r.client ? ` for ${r.client}` : ''}, delivered.`,
    other: (r) => `${r.name}. ${r.commits}${r.from ? ` since ${r.from}` : ''}.`,
  },
}
