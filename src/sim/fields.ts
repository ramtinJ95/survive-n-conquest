import { Job, kindOf, siteMidX, siteMidY, withinReach } from './buildings';
import { SEASONS, TICKS_PER_SECOND, seasonIndexAt } from './calendar';
import { Claim } from './claims';
import { Good } from './goods';
import { planPath } from './paths';
import type { Sim } from './sim';
import type { TaskKind } from './tasks';
import { noteTileChange } from './tileChanges';
import { CHUNK_SHIFT, type TileSet, createTileSet, setOpen } from './tileSet';

/** Work ticks by one farmer that sow a field tile. */
export const SOW_WORK_TICKS = 15 * TICKS_PER_SECOND;
const SPRING = SEASONS.indexOf('Spring');
/** `sownAt` of a tile that bears no crop. */
export const NOT_SOWN = -1;

/** The state of a field tile's crop, read from what the tile stores. */
export const FieldState = { Bare: 0, Sown: 1 } as const;
export type FieldState = (typeof FieldState)[keyof typeof FieldState];

/** What a field tile stores of its crop, the size of the map. The main thread keeps a copy from the tile changes. */
export interface FieldTiles {
  /** The tick of the step in which each tile was sown, or `NOT_SOWN`. */
  readonly sownAt: Int32Array;
}

/**
 * The fields, as tile state the size of the map. The set's tiles are the
 * tiles under a field claim, counted by chunk, so a farmer's look skips the
 * chunks of its reach that hold no field.
 */
export interface Fields extends TileSet, FieldTiles {
  /** The farmer that sows each tile, or -1. */
  readonly taker: Int32Array;
  /** Work ticks done on each tile toward its sowing. Work stays when the farmer leaves, and goes with the field. */
  readonly progress: Uint16Array;
}

export function createFieldTiles(tiles: number): FieldTiles {
  return { sownAt: new Int32Array(tiles).fill(NOT_SOWN) };
}

export function createFields(size: number): Fields {
  const tiles = size * size;
  return { ...createTileSet(size), ...createFieldTiles(tiles), taker: new Int32Array(tiles).fill(-1), progress: new Uint16Array(tiles) };
}

/** The state of a field tile's crop. */
export function fieldState(fields: FieldTiles, tile: number): FieldState {
  return fields.sownAt[tile] === NOT_SOWN ? FieldState.Bare : FieldState.Sown;
}

/** Whether the farmers sow at `tick`: in spring only. Seasons turn at midnight, so sowing starts at the first dawn of spring and ends at its last dusk. */
export function sowsAt(tick: number): boolean {
  return seasonIndexAt(tick) === SPRING;
}

/** Whether a tile's center lies within the reach of the workplace in `slot`. */
function inReach(sim: Sim, slot: number, tile: number): boolean {
  const { size } = sim.map;
  return withinReach(sim.orders.sites, slot, (tile % size) + 0.5, (tile - (tile % size)) / size + 0.5);
}

/**
 * The bare field tile nearest a point in a straight line among those within
 * the reach of the farm in `slot`, that no farmer sows and that a walk from the
 * camp reaches, or -1. It reads only the chunks of the reach that hold a field
 * tile. Equally near tiles go to the lowest tile index.
 */
function nearestToSow(sim: Sim, slot: number, px: number, py: number): number {
  const { map, fields, flow } = sim;
  if (fields.count === 0 || !sowsAt(sim.tick)) return -1;
  const { sites } = sim.orders;
  const { size } = map;
  const { reach } = kindOf(sites, slot);
  const cx = siteMidX(sites, slot);
  const cy = siteMidY(sites, slot);
  const x0 = Math.max(Math.ceil(cx - reach - 0.5), 0);
  const x1 = Math.min(Math.floor(cx + reach - 0.5), size - 1);
  const y0 = Math.max(Math.ceil(cy - reach - 0.5), 0);
  const y1 = Math.min(Math.floor(cy + reach - 0.5), size - 1);
  let best = -1;
  let bestDistance = Infinity;
  for (let j = y0 >> CHUNK_SHIFT; j <= y1 >> CHUNK_SHIFT; j++) {
    for (let i = x0 >> CHUNK_SHIFT; i <= x1 >> CHUNK_SHIFT; i++) {
      if (fields.chunkOpen[j * fields.chunks + i] === 0) continue;
      const yEnd = Math.min(y1, ((j + 1) << CHUNK_SHIFT) - 1);
      const xEnd = Math.min(x1, ((i + 1) << CHUNK_SHIFT) - 1);
      for (let y = Math.max(y0, j << CHUNK_SHIFT); y <= yEnd; y++) {
        const dy = y + 0.5 - py;
        for (let x = Math.max(x0, i << CHUNK_SHIFT); x <= xEnd; x++) {
          const tile = y * size + x;
          if (fields.open[tile] === 0 || fields.sownAt[tile] !== NOT_SOWN || fields.taker[tile] !== -1 || flow.next[tile] === -1) continue;
          if (!inReach(sim, slot, tile)) continue;
          const dx = x + 0.5 - px;
          const distance = dx * dx + dy * dy;
          if (distance < bestDistance || (distance === bestDistance && tile < best)) {
            best = tile;
            bestDistance = distance;
          }
        }
      }
    }
  }
  return best;
}

/** Sends a farmer with empty hands to the bare field tile nearest it in its farm's reach, and reserves the tile. */
function take(sim: Sim, id: number): boolean {
  const { villagers, fields } = sim;
  const workplace = villagers.workplace[id]!;
  if (workplace < 0 || villagers.carried[id] !== Good.None) return false;
  const tile = nearestToSow(sim, workplace, villagers.x[id]!, villagers.y[id]!);
  if (tile < 0 || !planPath(sim, id, tile)) return false;
  fields.taker[tile] = id;
  villagers.taskTile[id] = tile;
  villagers.workTile[id] = tile;
  return true;
}

/**
 * The farmer still sows its tile: it is spring, the tile is still a bare
 * field, and it lies in the reach of the farm the farmer works at now, which a
 * farmer moved to another farm by a change of places does not.
 */
function holds(sim: Sim, id: number): boolean {
  const { villagers, fields } = sim;
  const tile = villagers.taskTile[id]!;
  const workplace = villagers.workplace[id]!;
  return (
    tile >= 0 &&
    workplace >= 0 &&
    fields.taker[tile] === id &&
    sim.orders.claims[tile] === Claim.Field &&
    fields.sownAt[tile] === NOT_SOWN &&
    sowsAt(sim.tick) &&
    inReach(sim, workplace, tile)
  );
}

/** One tick of sowing. The tile counts as sown from the step of its last work tick on. */
function work(sim: Sim, id: number): boolean {
  const { fields } = sim;
  const tile = sim.villagers.taskTile[id]!;
  fields.progress[tile] = fields.progress[tile]! + 1;
  if (fields.progress[tile]! < SOW_WORK_TICKS) return false;
  fields.progress[tile] = 0;
  fields.sownAt[tile] = sim.tick;
  fields.taker[tile] = -1;
  sim.tally.sown += 1;
  noteTileChange(sim, tile);
  return true;
}

/** Frees the tile the task still holds, at dusk, when the farmer loses its place, or when the field is cancelled. */
function release(sim: Sim, id: number): void {
  const tile = sim.villagers.taskTile[id]!;
  if (tile >= 0 && sim.fields.taker[tile] === id) sim.fields.taker[tile] = -1;
}

/** Keeps the set of field tiles up to the claims. A tile whose field was cancelled loses its crop and the work done on it. */
function refresh(sim: Sim, tile: number): void {
  const { fields } = sim;
  const field = sim.orders.claims[tile] === Claim.Field;
  setOpen(fields, sim.map.size, tile, field);
  if (field) return;
  fields.progress[tile] = 0;
  if (fields.sownAt[tile] === NOT_SOWN) return;
  fields.sownAt[tile] = NOT_SOWN;
  noteTileChange(sim, tile);
}

const nothing = () => {};

/** Sowing the bare field tiles in a farm's reach in spring, the work of a farmer. */
export const SOWING: TaskKind = { job: Job.Farmer, take, holds, work, release, refresh, reopen: nothing };
