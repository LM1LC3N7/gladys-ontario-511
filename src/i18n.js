// -----------------------------------------------------------------------------
// Every text the integration writes, in English and French: the summary of a
// zone (in the language of the configuration), the status and the test
// button (both languages, Gladys picks). Times are shown in Eastern time, the
// time zone of Ontario. The texts of Ontario 511 (descriptions, conditions)
// come in the language of the configuration (`lang=en|fr`); road names stay
// as the source writes them.
// -----------------------------------------------------------------------------

import { TIME_ZONE } from './constants.js';

const TEXTS = {
  en: {
    noEvent: 'No event',
    eventCount: ({ events, closures }) =>
      `${events === 1 ? '1 event' : `${events} events`}${closures > 0 ? ` (${closures} closure${closures > 1 ? 's' : ''})` : ''}`,
    more: ({ count }) => `${count} more`,
    allLanesClosed: 'all lanes closed',
    visibility: ({ text }) => `visibility ${text}`,
    winterCount: ({ count }) =>
      count === 1 ? 'Winter conditions on 1 segment' : `Winter conditions on ${count} segments`,
    roadsBare: 'Roads bare',
    noCurrentReport: 'No current winter road report in the zone',
    conditionsUnread: 'Winter road conditions not read',
    eventsUnread: 'Events not read',
    zoneDefault: ({ slot }) => `Ontario 511 zone ${slot}`,
    eventsFeature: 'Events in effect',
    incidentsFeature: 'Incidents',
    roadworkFeature: 'Roadwork',
    closuresFeature: 'Closures',
    winterFeature: 'Segments in winter conditions',
    summaryFeature: 'Summary',
  },
  fr: {
    noEvent: 'Aucun événement',
    eventCount: ({ events, closures }) =>
      `${events === 1 ? '1 événement' : `${events} événements`}${closures > 0 ? ` (${closures} fermeture${closures > 1 ? 's' : ''})` : ''}`,
    more: ({ count }) => `${count} de plus`,
    allLanesClosed: 'toutes voies fermées',
    visibility: ({ text }) => `visibilité ${text}`,
    winterCount: ({ count }) =>
      count === 1
        ? 'Conditions hivernales sur 1 tronçon'
        : `Conditions hivernales sur ${count} tronçons`,
    roadsBare: 'Chaussées dégagées',
    noCurrentReport: "Aucun rapport récent sur l'état des routes en hiver dans la zone",
    conditionsUnread: 'État des routes en hiver non lu',
    eventsUnread: 'Événements non lus',
    zoneDefault: ({ slot }) => `Ontario 511 zone ${slot}`,
    eventsFeature: 'Événements en cours',
    incidentsFeature: 'Incidents',
    roadworkFeature: 'Travaux',
    closuresFeature: 'Fermetures',
    winterFeature: 'Tronçons en conditions hivernales',
    summaryFeature: 'Résumé',
  },
};

const TYPES = {
  en: {
    accidentsAndIncidents: 'incident',
    roadwork: 'roadwork',
    closures: 'closure',
    other: 'event',
  },
  fr: {
    accidentsAndIncidents: 'incident',
    roadwork: 'travaux',
    closures: 'fermeture',
    other: 'événement',
  },
};

// The documented `DirectionOfTravel` values; "Unknown" says nothing.
const DIRECTIONS = {
  'All Directions': { en: 'all directions', fr: 'toutes directions' },
  'Both Directions': { en: 'both directions', fr: 'deux directions' },
  Northbound: { en: 'northbound', fr: 'direction nord' },
  Eastbound: { en: 'eastbound', fr: 'direction est' },
  Southbound: { en: 'southbound', fr: 'direction sud' },
  Westbound: { en: 'westbound', fr: 'direction ouest' },
  Inbound: { en: 'inbound', fr: 'entrant' },
  Outbound: { en: 'outbound', fr: 'sortant' },
};

export function t(language, key, params = {}) {
  const text = (TEXTS[language] ?? TEXTS.en)[key];
  return typeof text === 'function' ? text(params) : text;
}

export function typeLabel(language, type) {
  return (TYPES[language] ?? TYPES.en)[type] ?? TYPES.en.other;
}

/** A direction of travel in the language asked; '' when unknown or absent. */
export function directionLabel(language, direction) {
  const known = Object.hasOwn(DIRECTIONS, direction) ? DIRECTIONS[direction] : null;
  return known ? known[language === 'fr' ? 'fr' : 'en'] : '';
}

/** A time in Eastern time: "Nov 27, 14:05 ET" / "27 nov., 14 h 05 (heure de l'Est)". */
export function formatTime(ms, language) {
  if (!Number.isFinite(ms)) return '?';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const month = Number(parts.month);
  if (language === 'fr') {
    const months = [
      'janv.',
      'févr.',
      'mars',
      'avr.',
      'mai',
      'juin',
      'juil.',
      'août',
      'sept.',
      'oct.',
      'nov.',
      'déc.',
    ];
    return `${Number(parts.day)} ${months[month - 1]}, ${parts.hour} h ${parts.minute} (heure de l'Est)`;
  }
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[month - 1]} ${Number(parts.day)}, ${parts.hour}:${parts.minute} ET`;
}

const ERRORS = {
  required: { en: 'is required', fr: 'est obligatoire' },
  not_a_number: { en: 'is not a number', fr: "n'est pas un nombre" },
  outside_on: {
    en: 'places the zone outside Ontario (Ontario 511 covers Ontario only)',
    fr: "place la zone hors de l'Ontario (Ontario 511 ne couvre que l'Ontario)",
  },
  radius: { en: 'must be between 1 and 200 km', fr: 'doit être entre 1 et 200 km' },
  roads_invalid: {
    en: 'holds an invalid road name (40 characters at most each)',
    fr: 'contient un nom de route invalide (40 caractères au plus chacun)',
  },
  roads_too_many: { en: 'names more than 10 roads', fr: 'nomme plus de 10 routes' },
  name_invalid: {
    en: 'is invalid (60 characters at most, no control character)',
    fr: 'est invalide (60 caractères au plus, sans caractère de contrôle)',
  },
  refresh: {
    en: 'must be a whole number of minutes between 10 and 120 (15 used)',
    fr: 'doit être un nombre entier de minutes entre 10 et 120 (15 utilisé)',
  },
  key_invalid: {
    en: 'cannot be a developer key (8 to 128 characters, no space, no accent)',
    fr: 'ne peut pas être une clé de développeur (8 à 128 caractères, sans espace ni accent)',
  },
};

/** "Field zone1_latitude is required" in both languages. */
export function configErrors(errors) {
  const line = (lang) =>
    errors
      .map(
        (e) =>
          `${lang === 'fr' ? 'Le champ' : 'Field'} ${e.field} ${ERRORS[e.code]?.[lang] ?? e.code}`,
      )
      .join('; ');
  return { en: line('en'), fr: line('fr') };
}

const FAILURES = {
  network: { en: 'Ontario 511 could not be reached', fr: 'Ontario 511 injoignable' },
  timeout: {
    en: 'Ontario 511 did not answer in time',
    fr: "Ontario 511 n'a pas répondu à temps",
  },
  rate: {
    en: 'Ontario 511 asked to slow down (429)',
    fr: 'Ontario 511 demande de ralentir (429)',
  },
  server: { en: 'Ontario 511 server error', fr: 'erreur du serveur Ontario 511' },
  http: { en: 'unexpected answer from Ontario 511', fr: "réponse inattendue d'Ontario 511" },
  key: {
    en: 'Ontario 511 refused the developer key (Invalid Key)',
    fr: 'Ontario 511 a refusé la clé de développeur (Invalid Key)',
  },
  format: { en: 'Ontario 511 answer not readable', fr: "réponse d'Ontario 511 illisible" },
  unreadable_events: {
    en: 'Ontario 511 sends items that cannot be read (its format may have changed), nothing published',
    fr: 'Ontario 511 envoie des données illisibles (son format a peut-être changé), rien publié',
  },
  too_big: { en: 'Ontario 511 answer too large', fr: "réponse d'Ontario 511 trop grande" },
  too_many: {
    en: 'Ontario 511 answer holds too many items, refused',
    fr: "réponse d'Ontario 511 avec trop d'éléments, refusée",
  },
  no_time: {
    en: 'no believable time to judge what is in effect (server Date missing or more than a day from the Gladys clock), not counted',
    fr: "pas d'heure fiable pour juger ce qui est en cours (en-tête Date absent ou à plus d'un jour de l'horloge de Gladys), non compté",
  },
  skipped: {
    en: 'not asked this round (refused alone before, asked again later)',
    fr: 'non demandé à ce tour (refusé seul avant, redemandé plus tard)',
  },
};

export function failure(kind, status, lang) {
  const text = FAILURES[kind]?.[lang] ?? FAILURES.http[lang];
  const full = status && kind !== 'rate' && kind !== 'key' ? `${text} (HTTP ${status})` : text;
  return full.charAt(0).toUpperCase() + full.slice(1);
}

/** The bilingual messages of the status and the test button. */
export const M = {
  starting: {
    en: 'Starting: the first read of Ontario 511 comes shortly.',
    fr: "Démarrage : la première lecture d'Ontario 511 arrive sous peu.",
  },
  configRetry: ({ seconds }) => ({
    en: `The configuration could not be read from Gladys; next try in ${seconds} s.`,
    fr: `La configuration n'a pas pu être lue dans Gladys ; nouvel essai dans ${seconds} s.`,
  }),
  noZone: {
    en: 'No valid zone: fill in the latitude and longitude of zone 1.',
    fr: 'Aucune zone valide : renseignez la latitude et la longitude de la zone 1.',
  },
  noKey: {
    en: 'No developer key: request a free one on 511on.ca (Developers) and enter it in the configuration. Nothing is read without it.',
    fr: "Aucune clé de développeur : demandez-en une gratuite sur 511on.ca (Développeurs) et saisissez-la dans la configuration. Rien n'est lu sans elle.",
  },
  keyRefused: {
    en: 'Ontario 511 refused the developer key (Invalid Key): nothing is read until the key is changed or the test button is pressed (one try per press).',
    fr: "Ontario 511 a refusé la clé de développeur (Invalid Key) : rien n'est lu tant que la clé n'est pas changée ou que le bouton de test n'est pas appuyé (un essai par appui).",
  },
  keyRetry: {
    en: 'The developer key is tried again now (one read); the status will tell the result.',
    fr: "La clé de développeur est réessayée maintenant (une lecture) ; l'état dira le résultat.",
  },
  keyRetryBusy: {
    en: 'A try of the developer key is already under way; the status will tell the result.',
    fr: "Un essai de la clé de développeur est déjà en cours ; l'état dira le résultat.",
  },
};

export function zoneLabel(zone, language) {
  return zone.name ?? t(language, 'zoneDefault', { slot: zone.slot });
}
