import {
  DIRECTIONS,
  type AdventureModule,
  type Condition,
  type Effect,
  type GameEvent,
  type ModuleDocumentName,
} from './index';
import { commandSyntaxError } from '../parser/parse';

// ─────────────────────────────────────────────────────────────────────────────
// Module consistency checks (design plan §4.2, layer 2).
//
// Zod (T4) proves each document is internally well-shaped. It cannot prove
// documents agree with EACH OTHER — that an exit's `to` names a location that
// exists, that a `printId` names a real string, that the sum of every
// attainable point equals the declared `maxScore`. That is this file's job.
//
// This is a pure function: no `fs`, no network, no engine-purity violations
// (see eslint.config.js's `src/engine/**` override — nothing here would trip
// it anyway). It is shared, unmodified, by the loader (T6, which cross-checks
// at load time per FR-6.2) and the CLI validator (T7). Landing it alone and
// first is what lets both build on the same notion of "consistent."
//
// Walkthrough commands are syntax-checked here (T13). Only their HEAD — that
// the first word is a verb, direction, or magic word. Noun resolution is
// state-dependent (`take key` is unparseable until `search tree` puts the key
// in the world), so a validator with no game state cannot judge it without
// being wrong about correct content. T23 catches the rest by playing it.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable, machine-readable error codes. T8's golden tests assert on `code`
 * (and `document`/`id`/`field`) rather than on `message` prose, which is
 * free to reword without breaking a test.
 */
export type ConsistencyErrorCode =
  | 'duplicate-id'
  | 'dangling-exit-target'
  | 'dangling-item-initial-location'
  | 'dangling-container-key'
  | 'dangling-spawn-location'
  | 'dangling-stash-location'
  | 'dangling-move-item-item'
  | 'dangling-move-item-target'
  | 'dangling-reveal-exit-location'
  | 'reveal-exit-target-missing'
  | 'reveal-exit-not-hidden'
  | 'dangling-teleport-target'
  | 'dangling-print-id'
  | 'dangling-die-message'
  | 'dangling-award-achievement'
  | 'dangling-activate-creature'
  | 'dangling-magic-word-event'
  | 'dangling-start-location'
  | 'dangling-repository-location'
  | 'dangling-lamp-item'
  | 'lamp-item-not-light-source'
  | 'dangling-lamp-refuel-item'
  | 'dangling-darkness-warning-message'
  | 'dangling-darkness-death-message'
  | 'dangling-condition-has-item'
  | 'dangling-condition-item-at-item'
  | 'dangling-condition-item-at-location'
  | 'dangling-condition-creature-at-creature'
  | 'dangling-condition-creature-at-location'
  | 'dangling-condition-visited'
  | 'dangling-condition-at-location'
  | 'dangling-trigger-target'
  | 'unparseable-walkthrough-command'
  | 'unwritten-flag-read'
  | 'orphan-location'
  | 'missing-art-file'
  | 'max-score-mismatch'
  | 'unbounded-score-effect';

/**
 * A single consistency error. `document`/`id`/`field` together pinpoint the
 * exact spot to fix (the design plan's requirement); `code` is what tests and
 * the CLI (T7) key off of; `message` is the human-readable prose shown to a
 * content author.
 */
export interface ConsistencyError {
  code: ConsistencyErrorCode;
  document: ModuleDocumentName;
  /** The id of the entity the error is attributed to (`manifest` for manifest-level checks). */
  id: string;
  field: string;
  message: string;
}

/** Item-location tokens that are always valid regardless of module content. */
const RESERVED_ITEM_LOCATIONS = new Set(['inventory', 'nowhere']);

/** `<name>.<ext>` → `<name>`, so an artId matches any extension. */
function artBaseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot <= 0 ? filename : filename.slice(0, dot);
}

/** A flag read (from a condition's `flag`/`notFlag`, or a `flagSet` trigger target). */
interface FlagRead {
  flag: string;
  document: ModuleDocumentName;
  id: string;
  field: string;
}

/**
 * Cross-checks an already schema-valid `AdventureModule` for reference and
 * arithmetic errors zod cannot see (design plan §4.2). Returns `[]` for a
 * clean module — never throws.
 */
export function checkConsistency(module: AdventureModule, artFiles: string[]): ConsistencyError[] {
  const errors: ConsistencyError[] = [];
  const push = (error: ConsistencyError): void => {
    errors.push(error);
  };

  // ── lookup tables (built once, per the task's efficiency note) ──────────
  const locationIds = new Set(module.locations.map((l) => l.id));
  const locationsById = new Map(module.locations.map((l) => [l.id, l]));
  const itemIds = new Set(module.items.map((i) => i.id));
  const itemsById = new Map(module.items.map((i) => [i.id, i]));
  const creatureIds = new Set(module.creatures.map((c) => c.id));
  const eventIds = new Set(module.events.map((e) => e.id));
  const achievementIds = new Set(module.achievements.map((a) => a.id));
  const stringIds = new Set(Object.keys(module.strings));
  const moduleVerbIds = new Set(module.vocabulary.verbs.map((v) => v.id));
  const artBaseNames = new Set(artFiles.map(artBaseName));

  /** A `to`/`initialLocation` value: a location id, a container item id, `inventory`, or `nowhere`. */
  const isItemLocation = (value: string): boolean =>
    RESERVED_ITEM_LOCATIONS.has(value) || locationIds.has(value) || itemIds.has(value);

  checkDuplicateIds(module, push);

  const flagReads: FlagRead[] = [];
  const flagWrites = new Set<string>();

  function checkCondition(
    cond: Condition,
    document: ModuleDocumentName,
    id: string,
    fieldPrefix: string,
  ): void {
    if (cond.flag !== undefined) {
      flagReads.push({ flag: cond.flag, document, id, field: `${fieldPrefix}.flag` });
    }
    if (cond.notFlag !== undefined) {
      flagReads.push({ flag: cond.notFlag, document, id, field: `${fieldPrefix}.notFlag` });
    }
    if (cond.hasItem !== undefined && !itemIds.has(cond.hasItem)) {
      push({
        code: 'dangling-condition-has-item',
        document,
        id,
        field: `${fieldPrefix}.hasItem`,
        message: `condition references unknown item "${cond.hasItem}"`,
      });
    }
    if (cond.itemAt !== undefined) {
      if (!itemIds.has(cond.itemAt.item)) {
        push({
          code: 'dangling-condition-item-at-item',
          document,
          id,
          field: `${fieldPrefix}.itemAt.item`,
          message: `condition references unknown item "${cond.itemAt.item}"`,
        });
      }
      if (!isItemLocation(cond.itemAt.location)) {
        push({
          code: 'dangling-condition-item-at-location',
          document,
          id,
          field: `${fieldPrefix}.itemAt.location`,
          message: `condition references unknown location "${cond.itemAt.location}"`,
        });
      }
    }
    if (cond.creatureAt !== undefined) {
      if (!creatureIds.has(cond.creatureAt.creature)) {
        push({
          code: 'dangling-condition-creature-at-creature',
          document,
          id,
          field: `${fieldPrefix}.creatureAt.creature`,
          message: `condition references unknown creature "${cond.creatureAt.creature}"`,
        });
      }
      if (!locationIds.has(cond.creatureAt.location)) {
        push({
          code: 'dangling-condition-creature-at-location',
          document,
          id,
          field: `${fieldPrefix}.creatureAt.location`,
          message: `condition references unknown location "${cond.creatureAt.location}"`,
        });
      }
    }
    if (cond.visited !== undefined && !locationIds.has(cond.visited)) {
      push({
        code: 'dangling-condition-visited',
        document,
        id,
        field: `${fieldPrefix}.visited`,
        message: `condition references unknown location "${cond.visited}"`,
      });
    }
    if (cond.atLocation !== undefined && !locationIds.has(cond.atLocation)) {
      push({
        code: 'dangling-condition-at-location',
        document,
        id,
        field: `${fieldPrefix}.atLocation`,
        message: `condition references unknown location "${cond.atLocation}"`,
      });
    }
    // `chance` draws from the RNG and names nothing — no reference to check.
  }

  function checkConditions(
    conds: Condition[] | undefined,
    document: ModuleDocumentName,
    id: string,
    fieldPrefix: string,
  ): void {
    if (conds === undefined) return;
    conds.forEach((cond, i) => {
      checkCondition(cond, document, id, `${fieldPrefix}[${i}]`);
    });
  }

  // ── locations.json ───────────────────────────────────────────────────────
  for (const location of module.locations) {
    for (const dir of DIRECTIONS) {
      const exit = location.exits[dir];
      if (exit === undefined) continue;
      if (!locationIds.has(exit.to)) {
        push({
          code: 'dangling-exit-target',
          document: 'locations.json',
          id: location.id,
          field: `exits.${dir}.to`,
          message: `exit "${dir}" points to unknown location "${exit.to}"`,
        });
      }
      checkConditions(exit.if, 'locations.json', location.id, `exits.${dir}.if`);
    }
  }

  // ── items.json ───────────────────────────────────────────────────────────
  for (const item of module.items) {
    if (!isItemLocation(item.initialLocation)) {
      push({
        code: 'dangling-item-initial-location',
        document: 'items.json',
        id: item.id,
        field: 'initialLocation',
        message: `initialLocation "${item.initialLocation}" is not a location, container, "inventory", or "nowhere"`,
      });
    }
    if (item.container?.keyId !== undefined && !itemIds.has(item.container.keyId)) {
      push({
        code: 'dangling-container-key',
        document: 'items.json',
        id: item.id,
        field: 'container.keyId',
        message: `container keyId "${item.container.keyId}" is not a known item`,
      });
    }
  }

  // ── creatures.json ───────────────────────────────────────────────────────
  for (const creature of module.creatures) {
    creature.spawn.locations.forEach((locationId, i) => {
      if (!locationIds.has(locationId)) {
        push({
          code: 'dangling-spawn-location',
          document: 'creatures.json',
          id: creature.id,
          field: `spawn.locations[${i}]`,
          message: `spawn location "${locationId}" is not a known location`,
        });
      }
    });
    checkConditions(creature.spawn.if, 'creatures.json', creature.id, 'spawn.if');
    if (creature.stashLocation !== undefined && !locationIds.has(creature.stashLocation)) {
      push({
        code: 'dangling-stash-location',
        document: 'creatures.json',
        id: creature.id,
        field: 'stashLocation',
        message: `stashLocation "${creature.stashLocation}" is not a known location`,
      });
    }
  }

  // ── events.json ──────────────────────────────────────────────────────────
  // Accumulated separately from milestone/treasure points because a positive
  // `addScore` in a repeatable (`once: false`) event is an error, not a
  // contribution — see the maxScore reconciliation below.
  let addScoreAttainable = 0;

  function checkEffect(effect: Effect, event: GameEvent, index: number): void {
    const field = (suffix: string): string => `do[${index}].${suffix}`;
    switch (effect.kind) {
      case 'print':
        break;
      case 'printId':
        if (!stringIds.has(effect.id)) {
          push({
            code: 'dangling-print-id',
            document: 'events.json',
            id: event.id,
            field: field('id'),
            message: `printId references unknown string "${effect.id}"`,
          });
        }
        break;
      case 'setFlag':
        flagWrites.add(effect.flag);
        break;
      case 'clearFlag':
        flagWrites.add(effect.flag);
        break;
      case 'moveItem':
        if (!itemIds.has(effect.item)) {
          push({
            code: 'dangling-move-item-item',
            document: 'events.json',
            id: event.id,
            field: field('item'),
            message: `moveItem references unknown item "${effect.item}"`,
          });
        }
        if (!isItemLocation(effect.to)) {
          push({
            code: 'dangling-move-item-target',
            document: 'events.json',
            id: event.id,
            field: field('to'),
            message: `moveItem.to "${effect.to}" is not a location, container, "inventory", or "nowhere"`,
          });
        }
        break;
      case 'revealExit': {
        const location = locationsById.get(effect.location);
        if (location === undefined) {
          push({
            code: 'dangling-reveal-exit-location',
            document: 'events.json',
            id: event.id,
            field: field('location'),
            message: `revealExit references unknown location "${effect.location}"`,
          });
        } else {
          const targetExit = location.exits[effect.dir];
          if (targetExit === undefined) {
            push({
              code: 'reveal-exit-target-missing',
              document: 'events.json',
              id: event.id,
              field: field('dir'),
              message: `location "${effect.location}" has no "${effect.dir}" exit to reveal`,
            });
          } else if (!targetExit.hidden) {
            push({
              code: 'reveal-exit-not-hidden',
              document: 'events.json',
              id: event.id,
              field: field('dir'),
              message: `revealExit targets "${effect.location}"'s "${effect.dir}" exit, which is not hidden — revealing it is a no-op`,
            });
          }
        }
        break;
      }
      case 'addScore':
        // Treasure carry/deposit and milestone points are the declared
        // scoring model (see effects.ts's banner); this variant is only
        // reconcilable against maxScore when it fires at most once.
        if (event.once) {
          addScoreAttainable += effect.points;
        } else if (effect.points > 0) {
          push({
            code: 'unbounded-score-effect',
            document: 'events.json',
            id: event.id,
            field: field('points'),
            message: `event "${event.id}" is repeatable (once: false) but awards a positive addScore of ${effect.points}, which is unbounded`,
          });
        }
        break;
      case 'teleport':
        if (!locationIds.has(effect.to)) {
          push({
            code: 'dangling-teleport-target',
            document: 'events.json',
            id: event.id,
            field: field('to'),
            message: `teleport references unknown location "${effect.to}"`,
          });
        }
        break;
      case 'die':
        if (effect.messageId !== undefined && !stringIds.has(effect.messageId)) {
          push({
            code: 'dangling-die-message',
            document: 'events.json',
            id: event.id,
            field: field('messageId'),
            message: `die references unknown string "${effect.messageId}"`,
          });
        }
        break;
      case 'award':
        if (!achievementIds.has(effect.achievement)) {
          push({
            code: 'dangling-award-achievement',
            document: 'events.json',
            id: event.id,
            field: field('achievement'),
            message: `award references unknown achievement "${effect.achievement}"`,
          });
        }
        break;
      case 'endGame':
        break;
      case 'activateCreature':
        if (!creatureIds.has(effect.creature)) {
          push({
            code: 'dangling-activate-creature',
            document: 'events.json',
            id: event.id,
            field: field('creature'),
            message: `activateCreature references unknown creature "${effect.creature}"`,
          });
        }
        break;
      default: {
        // Exhaustiveness check: a future Effect variant lands as a TS error
        // here rather than a silent no-op (design plan §10 risk register).
        const exhaustive: never = effect;
        throw new Error(`checkConsistency: unhandled effect kind ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  // A trigger's `target` is a reference like any other, and a typo'd one is
  // the quietest possible bug: the event simply never fires, and the content
  // reads as if it should. What `target` names depends on `type` (see
  // event.ts) — hence the switch rather than one lookup.
  function checkTriggerTarget(event: GameEvent): void {
    const target = event.on.target;
    if (target === undefined) return;
    const bad = (message: string): void => {
      push({
        code: 'dangling-trigger-target',
        document: 'events.json',
        id: event.id,
        field: 'on.target',
        message,
      });
    };

    switch (event.on.type) {
      case 'enter':
        if (!locationIds.has(target)) bad(`enter trigger references unknown location "${target}"`);
        break;
      case 'take':
      case 'drop':
      case 'use':
      case 'read':
      case 'open':
      case 'search':
        if (!itemIds.has(target)) {
          bad(`${event.on.type} trigger references unknown item "${target}"`);
        }
        break;
      case 'verb':
        // TODO(T13): core verbs ship in-engine (parser/vocab.ts), which does
        // not exist yet — so a `verb` trigger naming a core verb cannot be
        // resolved here. Only module-declared verbs are checked; T13 should
        // widen this to core verbs ∪ module verbs.
        if (!moduleVerbIds.has(target)) {
          bad(
            `verb trigger references verb "${target}", which is not declared in vocabulary.json (note: core verbs are not yet checkable — see TODO(T13))`,
          );
        }
        break;
      case 'flagSet':
        // Not a dangling reference — flags have no declaration site. Recorded
        // as a read so the unwritten-flag-read check below covers it.
        flagReads.push({
          flag: target,
          document: 'events.json',
          id: event.id,
          field: 'on.target',
        });
        break;
      case 'turnStart':
      case 'word':
        // Neither uses `target`; the schema carries `turn`/`word` instead.
        break;
      default: {
        const exhaustive: never = event.on.type;
        throw new Error(`checkConsistency: unhandled trigger type ${String(exhaustive)}`);
      }
    }
  }

  for (const event of module.events) {
    checkTriggerTarget(event);
    checkConditions(event.if, 'events.json', event.id, 'if');
    event.do.forEach((effect, i) => {
      checkEffect(effect, event, i);
    });
  }

  // ── vocabulary.json ──────────────────────────────────────────────────────
  module.vocabulary.magicWords.forEach((magicWord, i) => {
    if (!eventIds.has(magicWord.eventId)) {
      push({
        code: 'dangling-magic-word-event',
        document: 'vocabulary.json',
        id: magicWord.word,
        field: `magicWords[${i}].eventId`,
        message: `magic word "${magicWord.word}" references unknown event "${magicWord.eventId}"`,
      });
    }
  });

  // ── scoring.json (milestone conditions) ──────────────────────────────────
  for (const milestone of module.scoring.milestones) {
    checkConditions(milestone.when, 'scoring.json', milestone.id, 'when');
  }

  // ── manifest.json ────────────────────────────────────────────────────────
  const manifest = module.manifest;

  if (!locationIds.has(manifest.startLocation)) {
    push({
      code: 'dangling-start-location',
      document: 'manifest.json',
      id: 'manifest',
      field: 'startLocation',
      message: `startLocation "${manifest.startLocation}" is not a known location`,
    });
  }
  if (!locationIds.has(manifest.repositoryLocation)) {
    push({
      code: 'dangling-repository-location',
      document: 'manifest.json',
      id: 'manifest',
      field: 'repositoryLocation',
      message: `repositoryLocation "${manifest.repositoryLocation}" is not a known location`,
    });
  }

  const lampItem = itemsById.get(manifest.lamp.itemId);
  if (lampItem === undefined) {
    push({
      code: 'dangling-lamp-item',
      document: 'manifest.json',
      id: 'manifest',
      field: 'lamp.itemId',
      message: `lamp.itemId "${manifest.lamp.itemId}" is not a known item`,
    });
  } else if (!lampItem.lightSource) {
    push({
      code: 'lamp-item-not-light-source',
      document: 'manifest.json',
      id: 'manifest',
      field: 'lamp.itemId',
      message: `lamp.itemId "${manifest.lamp.itemId}" does not have lightSource: true`,
    });
  }

  if (manifest.lamp.refuel !== undefined && !itemIds.has(manifest.lamp.refuel.itemId)) {
    push({
      code: 'dangling-lamp-refuel-item',
      document: 'manifest.json',
      id: 'manifest',
      field: 'lamp.refuel.itemId',
      message: `lamp.refuel.itemId "${manifest.lamp.refuel.itemId}" is not a known item`,
    });
  }

  if (!stringIds.has(manifest.darkness.warningMessageId)) {
    push({
      code: 'dangling-darkness-warning-message',
      document: 'manifest.json',
      id: 'manifest',
      field: 'darkness.warningMessageId',
      message: `darkness.warningMessageId "${manifest.darkness.warningMessageId}" is not a known string`,
    });
  }
  if (!stringIds.has(manifest.darkness.deathMessageId)) {
    push({
      code: 'dangling-darkness-death-message',
      document: 'manifest.json',
      id: 'manifest',
      field: 'darkness.deathMessageId',
      message: `darkness.deathMessageId "${manifest.darkness.deathMessageId}" is not a known string`,
    });
  }

  // ── reachability: BFS from startLocation, ignoring conditions ───────────
  // Hidden exits are followed too — they are reachable once revealed, and a
  // conditional-only path is not an orphan. Skipped entirely when
  // startLocation itself doesn't resolve (already reported above); guessing
  // a start would just manufacture orphans that aren't the real bug.
  if (locationIds.has(manifest.startLocation)) {
    const visited = new Set<string>([manifest.startLocation]);
    const queue: string[] = [manifest.startLocation];
    for (let head = 0; head < queue.length; head++) {
      const currentId = queue[head];
      if (currentId === undefined) continue;
      const current = locationsById.get(currentId);
      if (current === undefined) continue;
      for (const dir of DIRECTIONS) {
        const exit = current.exits[dir];
        if (exit === undefined) continue;
        if (locationIds.has(exit.to) && !visited.has(exit.to)) {
          visited.add(exit.to);
          queue.push(exit.to);
        }
      }
    }
    for (const location of module.locations) {
      if (!visited.has(location.id)) {
        push({
          code: 'orphan-location',
          document: 'locations.json',
          id: location.id,
          field: 'id',
          message: `location "${location.id}" is not reachable from startLocation "${manifest.startLocation}"`,
        });
      }
    }
  }

  // ── art files ─────────────────────────────────────────────────────────
  const checkArt = (document: ModuleDocumentName, id: string, artId: string): void => {
    if (!artBaseNames.has(artId)) {
      push({
        code: 'missing-art-file',
        document,
        id,
        field: 'artId',
        message: `artId "${artId}" has no matching file (checked for "${artId}.<ext>")`,
      });
    }
  };
  for (const location of module.locations) checkArt('locations.json', location.id, location.artId);
  for (const item of module.items) checkArt('items.json', item.id, item.artId);
  for (const creature of module.creatures) checkArt('creatures.json', creature.id, creature.artId);

  // ── flags: every read must be written somewhere ─────────────────────────
  // Flags have no declaration site — a flag id is only ever *set* by a
  // setFlag/clearFlag effect (collected above). A read with no matching
  // write anywhere in the module is a typo that silently reads false
  // forever, which is worse than a schema error because nothing ever fails.
  for (const read of flagReads) {
    if (!flagWrites.has(read.flag)) {
      push({
        code: 'unwritten-flag-read',
        document: read.document,
        id: read.id,
        field: read.field,
        message: `flag "${read.flag}" is read but never set by any setFlag/clearFlag effect`,
      });
    }
  }

  // ── walkthrough commands parse (design plan §4.2) ────────────────────────
  module.walkthrough.steps.forEach((step, i) => {
    const error = commandSyntaxError(module, step.cmd);
    if (error !== undefined) {
      push({
        code: 'unparseable-walkthrough-command',
        document: 'walkthrough.json',
        id: `step ${i + 1}`,
        field: 'cmd',
        message: `"${step.cmd}" cannot be parsed: ${error}`,
      });
    }
  });

  // ── maxScore reconciliation ──────────────────────────────────────────────
  let attainable = 0;
  for (const item of module.items) {
    if (item.treasure !== undefined) {
      attainable += item.treasure.carryPoints + item.treasure.depositPoints;
    }
  }
  for (const milestone of module.scoring.milestones) {
    attainable += milestone.points;
  }
  attainable += addScoreAttainable;

  if (attainable !== manifest.maxScore) {
    push({
      code: 'max-score-mismatch',
      document: 'manifest.json',
      id: 'manifest',
      field: 'maxScore',
      message: `maxScore is ${manifest.maxScore} but the sum of attainable points is ${attainable}`,
    });
  }

  return errors;
}

/** Two entities sharing an id in the same document silently shadow one another. */
function checkDuplicateIds(
  module: AdventureModule,
  push: (error: ConsistencyError) => void,
): void {
  const checkOne = (document: ModuleDocumentName, entities: ReadonlyArray<{ id: string }>): void => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const entity of entities) {
      if (seen.has(entity.id)) {
        duplicates.add(entity.id);
      }
      seen.add(entity.id);
    }
    for (const id of duplicates) {
      push({
        code: 'duplicate-id',
        document,
        id,
        field: 'id',
        message: `duplicate id "${id}" appears more than once in ${document}`,
      });
    }
  };

  checkOne('locations.json', module.locations);
  checkOne('items.json', module.items);
  checkOne('creatures.json', module.creatures);
  checkOne('events.json', module.events);
  checkOne('achievements.json', module.achievements);
  checkOne('scoring.json', module.scoring.milestones);
}
