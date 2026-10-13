import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type LocationLevel,
  locationLevels,
  type LocationOptions,
  type ProjectLocation,
} from '@jengalink/contracts';

/** [name, children] down to cells; a cell's children are village names. */
type Node = [string, (Node | string)[]];

const norm = (s: string) => s.trim().toLocaleLowerCase('en');

/**
 * Rwanda's administrative divisions (5 provinces, 30 districts, 416 sectors,
 * 2,148 cells, 14,837 villages), from rwanda-geo (MIT; see data/rw.LICENSE).
 * Kept on the server so the apps stay small.
 */
@Injectable()
export class LocationsService {
  private readonly tree: Node[] = (
    JSON.parse(readFileSync(join(__dirname, 'data', 'rw.json'), 'utf8')) as {
      tree: Node[];
    }
  ).tree;

  /** Options for the level after the deepest one given. */
  options(path: Partial<Record<LocationLevel, string>>): LocationOptions {
    const chosen = this.walk(path);
    const level = locationLevels[chosen.depth];
    if (!level)
      throw new BadRequestException('A village has no further levels');
    return {
      level,
      options: chosen.children.map((c) => (typeof c === 'string' ? c : c[0])),
    };
  }

  /**
   * Checks a location level by level and returns it with official spelling.
   * Levels may stop early (a draft), but none may be skipped.
   */
  canonical(loc: ProjectLocation): ProjectLocation {
    const { names } = this.walk(loc, true);
    return Object.fromEntries(names.map((n, i) => [locationLevels[i], n]));
  }

  private walk(
    path: Partial<Record<LocationLevel, string>>,
    toVillage = false,
  ) {
    let children: (Node | string)[] = this.tree;
    const names: string[] = [];
    let depth = 0;
    const levels = toVillage ? locationLevels : locationLevels.slice(0, 4);
    for (const level of levels) {
      const wanted = path[level];
      if (!wanted) break;
      const match = children.find(
        (c) => norm(typeof c === 'string' ? c : c[0]) === norm(wanted),
      );
      if (!match)
        throw new BadRequestException({
          message: 'Unknown location',
          fieldErrors: [
            {
              field: `location.${level}`,
              message: `Unknown ${level}: ${wanted}`,
            },
          ],
        });
      names.push(typeof match === 'string' ? match : match[0]);
      children = typeof match === 'string' ? [] : match[1];
      depth++;
    }
    // A deeper level given without its parent is a mistake, not a draft.
    const deeper = levels.slice(depth + 1).find((l) => path[l]);
    if (deeper)
      throw new BadRequestException({
        message: 'Choose each level in order',
        fieldErrors: [
          {
            field: `location.${levels[depth]}`,
            message: `Missing ${levels[depth]}`,
          },
        ],
      });
    return { names, children, depth };
  }
}
