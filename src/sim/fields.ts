import { Job, kindOf, siteMidX, siteMidY, withinReach } from './buildings';
import { DAYS_PER_YEAR, SEASONS, TICKS_PER_SECOND, seasonIndexAt } from './calendar';
import { Claim } from './claims';
import { dawnDayAt } from './daylight';
import { Good } from './goods';
import { planPath } from './paths';
import type { Sim } from './sim';
import type { TaskKind } from './tasks';
import { noteTileChange } from './tileChanges';
import { CHUNK_SHIFT, type TileSet, createTileSet, setOpen } from './tileSet';

/** Work ticks by one farmer that sow a field tile. */
export const SOW_WORK_TICKS = 15 * TICKS_PER_SECOND;
/** Work ticks by one farmer that cut a ripe field tile. */
export const CUT_WORK_TICKS = 20 * TICKS_PER_SECOND;
/** A sown tile is ripe at this many dawns after its sowing. */
export const RIPE_DAWNS = 5;
/** The units of food a cut tile puts down. */
export const FOOD_PER_TILE = 4;
const SPRING = SEASONS.indexOf('Spring');
/** `sownAt` of a tile that bears no crop. */
export const NOT_SOWN = -1;
/** `cutAt` of a tile whose crop was not cut. */
export const NOT_CUT = -1;
/** The slots of `Fields.ripening`. */
const RIPENING_SLOTS = 2 ** Math.ceil(Math.log2(RIPE_DAWNS + 1));

/** The state of a field tile's crop, read from what the tile stores against the clock. A killed tile's crop stood at the frost. */
export const FieldState = { Bare: 0, Sown: 1, Ripe: 2, Cut: 3, Killed: 4 } as const;
export type FieldState = (typeof FieldState)[keyof typeof FieldState];

/** What a field tile stores of its crop, the size of the map. The main thread keeps a copy from the tile changes. */
export interface FieldTiles {
  /** The tick of the step in which each tile was sown, or `NOT_SOWN`. */
  readonly sownAt: Int32Array;
  /** The tick of the step in which each tile was cut, or `NOT_CUT`. */
  readonly cutAt: Int32Array;
  /**
   * The tick of the frost of the year of the latest dawn. It turns to the new
   * year's frost at the first dawn of spring, not at midnight, so it is the
   * frost of the year in which every standing crop was sown. A test or a
   * script that wants the frost on another day sets it after `createSim`.
   */
  frostAt: number;
}

/**
 * The fields, as tile state the size of the map. The set's tiles are the
 * tiles under a field claim, counted by chunk, so a farmer's look skips the
 * chunks of its reach that hold no field.
 */
export interface Fields extends TileSet, FieldTiles {
  /** The farmer that sows or cuts each tile, or -1. */
  readonly taker: Int32Array;
  /** Work ticks done on each tile toward its sowing. Work stays when the farmer leaves, and goes with the field. */
  readonly progress: Uint16Array;
  /** Work ticks done on each tile toward the cut of its crop. Work stays when the farmer leaves, and goes with the crop, so a crop the frost kills takes it. */
  readonly cutProgress: Uint16Array;
  /** The sown tiles that turn ripe at each dawn, in the slot of the dawn's day index modulo `RIPENING_SLOTS`. */
  readonly ripening: Uint32Array;
  /** The day index of the last dawn whose tiles `ripenFields` counted ripe. */
  ripenedDay: number;
  /** The tiles that turned ripe at the dawns of the calendar year the clock is in. */
  ripeThisYear: number;
  /** The tiles whose crop stands now, sown or ripe, neither cut nor killed. The frost kills this many. */
  standing: number;
  /** The tiles whose crop the frost killed in the calendar year the clock is in. */
  lostThisYear: number;
}

export function createFieldTiles(tiles: number, frostAt: number): FieldTiles {
  return { sownAt: new Int32Array(tiles).fill(NOT_SOWN), cutAt: new Int32Array(tiles).fill(NOT_CUT), frostAt };
}

export function createFields(size: number, frostAt: number): Fields {
  const tiles = size * size;
  return {
    ...createTileSet(size),
    ...createFieldTiles(tiles, frostAt),
    taker: new Int32Array(tiles).fill(-1),
    progress: new Uint16Array(tiles),
    cutProgress: new Uint16Array(tiles),
    ripening: new Uint32Array(RIPENING_SLOTS),
    ripenedDay: 0,
    ripeThisYear: 0,
    standing: 0,
    lostThisYear: 0,
  };
}

/** The dawns a tile's crop has grown since it was sown, up to `RIPE_DAWNS`, at which it is ripe. 0 for a tile that was not sown. */
export function grownDawns(fields: FieldTiles, tile: number, tick: number): number {
  const sownAt = fields.sownAt[tile]!;
  return sownAt === NOT_SOWN ? 0 : Math.min(dawnDayAt(tick) - dawnDayAt(sownAt), RIPE_DAWNS);
}

/** The day index of the first dawn of spring after `tick`, at which a tile cut or sown then is bare again. */
export function bareAgainDay(tick: number): number {
  return (Math.floor(dawnDayAt(tick) / DAYS_PER_YEAR) + 1) * DAYS_PER_YEAR;
}

/** Whether the ground is frozen at `tick`: from the frost to the first dawn of spring, when `frostAt` turns to the new year's. */
export function frozenAt(fields: FieldTiles, tick: number): boolean {
  return tick >= fields.frostAt;
}

/**
 * The state of a field tile's crop at `tick`. A cut tile is cut until the
 * first dawn of spring after the cut and bare from then on, whatever its
 * `sownAt` still holds. A crop that is not cut is killed from the frost of the
 * year it was sown in, and the tile is bare from the first dawn of spring
 * after the sowing.
 */
export function fieldState(fields: FieldTiles, tile: number, tick: number): FieldState {
  const cutAt = fields.cutAt[tile]!;
  if (cutAt !== NOT_CUT) return dawnDayAt(tick) < bareAgainDay(cutAt) ? FieldState.Cut : FieldState.Bare;
  const sownAt = fields.sownAt[tile]!;
  if (sownAt === NOT_SOWN || dawnDayAt(tick) >= bareAgainDay(sownAt)) return FieldState.Bare;
  if (frozenAt(fields, tick)) return FieldState.Killed;
  return grownDawns(fields, tile, tick) === RIPE_DAWNS ? FieldState.Ripe : FieldState.Sown;
}

/** The slot of `ripening` that counts a tile sown at `sownAt`. */
function ripeningSlot(sownAt: number): number {
  return (dawnDayAt(sownAt) + RIPE_DAWNS) & (RIPENING_SLOTS - 1);
}

/** Takes a standing crop that is lost out of the count of the dawn it would ripen at, while that dawn has not come. */
function leaveRipening(fields: Fields, tile: number): void {
  const sownAt = fields.sownAt[tile]!;
  if (dawnDayAt(sownAt) + RIPE_DAWNS <= fields.ripenedDay) return;
  const slot = ripeningSlot(sownAt);
  fields.ripening[slot] = fields.ripening[slot]! - 1;
}

/** A step of `DAWN`: counts the tiles that turn ripe at this dawn. */
export function ripenFields(sim: Sim): void {
  const { fields } = sim;
  const day = dawnDayAt(sim.tick);
  const slot = day & (RIPENING_SLOTS - 1);
  const ripe = fields.ripening[slot]!;
  sim.tally.ripened += ripe;
  fields.ripeThisYear += ripe;
  fields.ripening[slot] = 0;
  fields.ripenedDay = day;
}

/** Whether the farmers sow at `tick`: in spring only. Seasons turn at midnight, so sowing starts at the first dawn of spring and ends at its last dusk. */
export function sowsAt(tick: number): boolean {
  return seasonIndexAt(tick) === SPRING;
}

/** Whether a tile's center lies within the reach of the workplace in `slot`. */
export function inReach(sim: Sim, slot: number, tile: number): boolean {
  const { size } = sim.map;
  return withinReach(sim.orders.sites, slot, (tile % size) + 0.5, (tile - (tile % size)) / size + 0.5);
}

/**
 * The field tile nearest a point in a straight line among those within the
 * reach of the farm in `slot` that a walk from the camp reaches and that
 * `wanted` takes, or -1. It reads only the chunks of the reach that hold a
 * field tile and, when `chunks` is given, a tile of that set too. Equally near
 * tiles go to the lowest tile index.
 */
export function nearestInReach(sim: Sim, slot: number, px: number, py: number, wanted: (sim: Sim, tile: number) => boolean, chunks: TileSet | null): number {
  const { map, fields, flow } = sim;
  if (fields.count === 0 || (chunks !== null && chunks.count === 0)) return -1;
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
      const chunk = j * fields.chunks + i;
      if (fields.chunkOpen[chunk] === 0 || (chunks !== null && chunks.chunkOpen[chunk] === 0)) continue;
      const yEnd = Math.min(y1, ((j + 1) << CHUNK_SHIFT) - 1);
      const xEnd = Math.min(x1, ((i + 1) << CHUNK_SHIFT) - 1);
      for (let y = Math.max(y0, j << CHUNK_SHIFT); y <= yEnd; y++) {
        const dy = y + 0.5 - py;
        for (let x = Math.max(x0, i << CHUNK_SHIFT); x <= xEnd; x++) {
          const tile = y * size + x;
          if (fields.open[tile] === 0 || flow.next[tile] === -1 || !wanted(sim, tile)) continue;
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

/** A bare field tile that no farmer sows. */
function toSow(sim: Sim, tile: number): boolean {
  return sim.fields.taker[tile] === -1 && fieldState(sim.fields, tile, sim.tick) === FieldState.Bare;
}

/** Sends a farmer with empty hands to the bare field tile nearest it in its farm's reach, and reserves the tile. */
function take(sim: Sim, id: number): boolean {
  const { villagers, fields } = sim;
  const workplace = villagers.workplace[id]!;
  if (workplace < 0 || villagers.carried[id] !== Good.None) return false;
  if (!sowsAt(sim.tick)) return false;
  const tile = nearestInReach(sim, workplace, villagers.x[id]!, villagers.y[id]!, toSow, null);
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
    fieldState(fields, tile, sim.tick) === FieldState.Bare &&
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
  fields.cutProgress[tile] = 0;
  fields.sownAt[tile] = sim.tick;
  fields.cutAt[tile] = NOT_CUT;
  fields.taker[tile] = -1;
  fields.standing += 1;
  const slot = ripeningSlot(sim.tick);
  fields.ripening[slot] = fields.ripening[slot]! + 1;
  sim.tally.sown += 1;
  noteTileChange(sim, tile);
  return true;
}

/** Frees the tile the task still holds, at dusk, when the farmer loses its place, or when the field is cancelled. */
function release(sim: Sim, id: number): void {
  const tile = sim.villagers.taskTile[id]!;
  if (tile >= 0 && sim.fields.taker[tile] === id) sim.fields.taker[tile] = -1;
}

/** Keeps the set of field tiles up to the claims. A tile whose field was cancelled loses its crop, sown, ripe, cut, or killed, and the work done on it. */
function refresh(sim: Sim, tile: number): void {
  const { fields } = sim;
  const field = sim.orders.claims[tile] === Claim.Field;
  setOpen(fields, sim.map.size, tile, field);
  if (field) return;
  fields.progress[tile] = 0;
  fields.cutProgress[tile] = 0;
  if (fields.sownAt[tile] === NOT_SOWN && fields.cutAt[tile] === NOT_CUT) return;
  const state = fieldState(fields, tile, sim.tick);
  if (state === FieldState.Sown || state === FieldState.Ripe) {
    fields.standing -= 1;
    leaveRipening(fields, tile);
  }
  fields.sownAt[tile] = NOT_SOWN;
  fields.cutAt[tile] = NOT_CUT;
  noteTileChange(sim, tile);
}

const nothing = () => {};

/** Sowing the bare field tiles in a farm's reach in spring, the work of a farmer. */
export const SOWING: TaskKind = { job: Job.Farmer, take, holds, work, release, refresh, reopen: nothing };
