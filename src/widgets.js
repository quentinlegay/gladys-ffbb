// -----------------------------------------------------------------------------
// Dashboard widgets (SDK v0.14+, Gladys 5.1+).
//
//   - team_match  one followed team, chosen in the widget settings: the score
//                 (live tiles bound to the device features), the period and
//                 clock, the tip-off, home or away, and a Refresh button;
//   - my_teams    every followed team in one list, with a badge (LIVE, the
//                 result, or NEXT).
//
// The content is declarative, rendered by the core with its own theme. The
// tracker nudges both widgets (requestWidgetRefresh) whenever something shown
// changed; the TTL is only a safety net.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  formatClock,
  formatKickoff,
  formatResult,
  formatStatus,
  multilingual,
  shortName,
} from './format.js';
import { FEATURE, teamExternalIds } from './devices/team.js';

const logger = createLogger({ name: 'widgets' });

export const TEAM_MATCH_WIDGET = 'team_match';
export const MY_TEAMS_WIDGET = 'my_teams';
export const WIDGET_KEYS = [TEAM_MATCH_WIDGET, MY_TEAMS_WIDGET];

const REFRESH_ACTION = 'refresh';
const LIVE_TTL = 30;
const IDLE_TTL = 600;
// A `list` card-list shows 8 rows at most.
const MAX_LIST_ITEMS = 8;

// "(home)" / "(away)" after the opponent's name.
const HOME_AWAY = {
  en: { home: 'home', away: 'away' },
  fr: { home: 'domicile', away: 'extérieur' },
};

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function both(build, max) {
  return Object.fromEntries(
    Object.entries(multilingual(build)).map(([language, text]) => [language, clip(text, max)]),
  );
}

function badge(match) {
  if (!match) {
    return undefined;
  }
  if (match.state === 'in') {
    return { text: { en: 'LIVE', fr: 'DIRECT' }, color: WIDGET_COLORS.DANGER };
  }
  if (match.state === 'post' && match.completed) {
    const color = {
      win: WIDGET_COLORS.SUCCESS,
      loss: WIDGET_COLORS.DANGER,
      draw: WIDGET_COLORS.NEUTRAL,
    }[match.result];
    return { text: multilingual((language) => formatResult(match.result, language)), color };
  }
  if (match.state === 'pre') {
    return { text: { en: 'NEXT', fr: 'À VENIR' }, color: WIDGET_COLORS.INFO };
  }
  return undefined;
}

function stateRow(match, config, now) {
  if (match.state === 'in') {
    return {
      label: { en: 'Live', fr: 'En direct' },
      icon: 'activity',
      value: both((language) => formatClock(match, language) || '…', 40),
      color: WIDGET_COLORS.DANGER,
    };
  }
  if (match.state === 'post') {
    return {
      label: { en: 'Result', fr: 'Résultat' },
      icon: 'flag',
      value: match.completed
        ? both((language) => formatResult(match.result, language), 40)
        : both((language) => formatStatus(match, { ...config, language }, now).split(' · ')[0], 40),
      color: badge(match)?.color ?? WIDGET_COLORS.NEUTRAL,
    };
  }
  return {
    label: { en: 'Status', fr: 'Statut' },
    icon: 'clock',
    value: both(
      (language) => formatStatus(match, { ...config, language }, now).split(' · ')[0],
      40,
    ),
    color: WIDGET_COLORS.INFO,
  };
}

function refreshButton() {
  return {
    type: 'button',
    label: { en: 'Refresh', fr: 'Actualiser' },
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: REFRESH_ACTION },
  };
}

function teamMatchContent(gladys, tracked, config, now) {
  const { match } = tracked;
  const name = tracked.info.name;
  if (!match) {
    return {
      ttl_seconds: IDLE_TTL,
      components: [
        { type: 'text', variant: 'heading', text: clip(name, 40) },
        {
          type: 'status',
          items: [
            {
              label: { en: 'Status', fr: 'Statut' },
              icon: 'calendar',
              value: { en: 'No game scheduled', fr: 'Aucun match prévu' },
              color: WIDGET_COLORS.NEUTRAL,
            },
          ],
        },
        refreshButton(),
      ],
    };
  }

  const ids = teamExternalIds(gladys, tracked.spec, tracked.info.id);
  const created = (gladys.devices ?? []).some((device) => device.external_id === ids.device);
  const started = match.state !== 'pre';
  const heading = started
    ? `${shortName(match.team)} ${match.team.score} – ${match.opponent.score} ${shortName(match.opponent)}`
    : `${shortName(match.team)} – ${shortName(match.opponent)}`;
  const caption = [tracked.spec.competitionName, match.venue].filter(Boolean).join(' · ');

  // Live tiles follow the published states in real time, but only exist once
  // the user created the device; before that, the scores are plain values.
  const tile = (feature, label, score) =>
    created
      ? {
          type: 'value',
          label: clip(label, 24),
          icon: 'award',
          device_feature: ids.feature(feature),
        }
      : { type: 'value', label: clip(label, 24), icon: 'award', value: score };

  return {
    ttl_seconds: match.state === 'in' ? LIVE_TTL : IDLE_TTL,
    components: [
      { type: 'text', variant: 'heading', text: clip(heading, 40) },
      ...(caption ? [{ type: 'text', variant: 'caption', text: clip(caption, 80) }] : []),
      ...(started
        ? [
            tile(FEATURE.TEAM_SCORE, shortName(match.team), match.team.score),
            tile(FEATURE.OPPONENT_SCORE, shortName(match.opponent), match.opponent.score),
          ]
        : []),
      {
        type: 'status',
        items: [
          stateRow(match, config, now),
          {
            label: { en: 'Tip-off', fr: 'Coup d’envoi' },
            icon: 'calendar',
            value: both((language) => formatKickoff(match, language, config.timezone), 40),
            color: WIDGET_COLORS.NEUTRAL,
          },
          {
            label: { en: 'Opponent', fr: 'Adversaire' },
            icon: match.homeAway === 'home' ? 'home' : 'navigation',
            value: both(
              (language) =>
                `${match.opponent.name} (${HOME_AWAY[language][match.homeAway === 'home' ? 'home' : 'away']})`,
              40,
            ),
            color: WIDGET_COLORS.NEUTRAL,
          },
        ],
      },
      refreshButton(),
    ],
  };
}

function myTeamsContent(tracker, config, now) {
  const teams = tracker.list().filter((t) => t.info);
  if (teams.length === 0) {
    return {
      ttl_seconds: IDLE_TTL,
      components: [
        {
          type: 'text',
          variant: 'body',
          text: {
            en: 'No team followed yet: add some in the integration configuration.',
            fr: "Aucune équipe suivie : ajoutez-en dans la configuration de l'intégration.",
          },
        },
      ],
    };
  }
  // What matters now first: live games, then the next tip-offs.
  const rank = (t) => (t.match?.state === 'in' ? 0 : t.match?.state === 'pre' ? 1 : 2);
  const sorted = [...teams].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      Date.parse(a.match?.kickoff ?? 0) - Date.parse(b.match?.kickoff ?? 0) ||
      a.info.name.localeCompare(b.info.name),
  );
  const live = teams.some((t) => t.match?.state === 'in');
  return {
    ttl_seconds: live ? LIVE_TTL : IDLE_TTL,
    components: [
      {
        type: 'card-list',
        display: 'list',
        items: sorted.slice(0, MAX_LIST_ITEMS).map((t) => {
          const item = {
            title: clip(t.info.name, 60),
            subtitle: both(
              (language) => formatStatus(t.match ?? null, { ...config, language }, now),
              60,
            ),
          };
          const mark = badge(t.match);
          if (mark) {
            item.badge = mark;
          }
          return item;
        }),
      },
      refreshButton(),
    ],
  };
}

/**
 * The widget handlers, keyed by the manifest `widgets` keys. Each exposes
 * get(gladys, { settings, language, units, config }) and
 * action(gladys, { actionKey, params, settings, config }).
 */
export function createWidgets(tracker) {
  const now = () => (typeof tracker.now === 'function' ? tracker.now() : Date.now());

  async function refreshAction(actionKey) {
    if (actionKey !== REFRESH_ACTION) {
      // Throwing acks the action as failed: the message reaches the user.
      throw new Error(`Unknown widget action: ${actionKey}`);
    }
    await tracker.refresh();
    return { en: 'Scores refreshed', fr: 'Scores actualisés' };
  }

  return {
    [TEAM_MATCH_WIDGET]: {
      async get(gladys, { settings, config }) {
        logger.debug(`onWidgetGet <- ${TEAM_MATCH_WIDGET} ${settings?.team}`);
        const tracked = tracker.findByDevice(settings?.team);
        if (!tracked) {
          return {
            ttl_seconds: IDLE_TTL,
            components: [
              {
                type: 'text',
                variant: 'body',
                text: {
                  en: 'Pick a followed team in the settings of this widget.',
                  fr: 'Choisissez une équipe suivie dans les réglages de ce widget.',
                },
              },
            ],
          };
        }
        return teamMatchContent(gladys, tracked, config, now());
      },
      action: (_gladys, { actionKey }) => refreshAction(actionKey),
    },
    [MY_TEAMS_WIDGET]: {
      async get(_gladys, { config }) {
        logger.debug(`onWidgetGet <- ${MY_TEAMS_WIDGET}`);
        return myTeamsContent(tracker, config, now());
      },
      action: (_gladys, { actionKey }) => refreshAction(actionKey),
    },
  };
}

/**
 * Freshness nudge: ask the core to re-pull every widget NOW. Rate-limited
 * core-side (1 per 10 s per widget) and dropped while disconnected, so it is
 * also sent after every (re)connection.
 */
export function refreshWidgets(gladys) {
  for (const key of WIDGET_KEYS) {
    gladys.requestWidgetRefresh(key);
  }
}
