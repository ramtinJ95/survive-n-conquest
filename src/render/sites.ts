import { BoxGeometry, ConeGeometry, Group, InstancedMesh, MeshLambertMaterial, Object3D } from 'three';
import { HOUSE_WORK_TICKS } from '../sim/building';
import type { TileMap } from '../sim/map';
import { MAX_SITES, type Orders, SiteState } from '../sim/orders';

/** Dark timber for the frame, so that it stands apart from the pale logs stacked beside it. */
const FRAME_COLOR = 0x5b3a1e;
/** Cream walls and a slate roof, which pass for no settler, monster, rock, good, or order mark. */
const WALL_COLOR = 0xeadfc8;
const ROOF_COLOR = 0x4b5363;
/** The walls stand this far in from the edge of the nine tiles, and this tall above the highest of them, in meters. */
const WALL_INSET = 0.2;
const WALL_HEIGHT = 1.9;
/** The walls reach this far below the lowest tile, so that a house on a slope shows no gap under it. */
const WALL_FOOTING = 0.3;
const ROOF_HEIGHT = 1.4;
const ROOF_HALF_SIDE = 1.55;
const POST_WIDTH = 0.24;
const BEAM_WIDTH = 0.18;
const POSTS_PER_SITE = 4;

function partMesh(name: string, geometry: BoxGeometry | ConeGeometry, color: number, perSite: number): InstancedMesh {
  const mesh = new InstancedMesh(geometry, new MeshLambertMaterial({ color, flatShading: true }), MAX_SITES * perSite);
  mesh.name = name;
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Draws each site's building work and each finished house as readable
 * primitives. A frame of four posts rises on a site with its share of the work
 * done, joined by beams at its top, so the progress reads without the label. A
 * finished house is a box inset from its nine tiles under a pyramid roof.
 */
export function createSites(map: TileMap) {
  const half = map.size / 2;
  const unitBox = () => new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const posts = partMesh('site-posts', unitBox(), FRAME_COLOR, POSTS_PER_SITE);
  const beams = partMesh('site-beams', unitBox(), FRAME_COLOR, POSTS_PER_SITE);
  const walls = partMesh('house-walls', unitBox(), WALL_COLOR, 1);
  const roofs = partMesh(
    'house-roofs',
    new ConeGeometry(Math.SQRT2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    ROOF_COLOR,
    1,
  );
  const group = new Group();
  group.name = 'sites';
  group.add(posts, beams, walls, roofs);
  const pose = new Object3D();

  const put = (mesh: InstancedMesh, index: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    pose.position.set(x, y, z);
    pose.scale.set(sx, sy, sz);
    pose.updateMatrix();
    mesh.setMatrixAt(index, pose.matrix);
  };

  /** Redraws every site and house from the orders. */
  const show = (orders: Orders) => {
    const { sites } = orders;
    let frames = 0;
    let houses = 0;
    for (let slot = 0; slot < MAX_SITES; slot++) {
      const state = sites.state[slot]!;
      const work = sites.work[slot]!;
      if (state === SiteState.Free || (state === SiteState.Site && work === 0)) continue;
      const cx = sites.x[slot]!;
      const cy = sites.y[slot]!;
      let lowest = Infinity;
      let highest = -Infinity;
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let x = cx - 1; x <= cx + 1; x++) {
          const height = map.heights[y * map.size + x]!;
          lowest = Math.min(lowest, height);
          highest = Math.max(highest, height);
        }
      }
      const x = cx + 0.5 - half;
      const z = cy + 0.5 - half;
      const base = lowest - WALL_FOOTING;
      const top = highest + WALL_HEIGHT;
      const side = 3 - 2 * WALL_INSET;
      if (state === SiteState.House) {
        put(walls, houses, x, base, z, side, top - base, side);
        put(roofs, houses, x, top, z, ROOF_HALF_SIDE, ROOF_HEIGHT, ROOF_HALF_SIDE);
        houses++;
        continue;
      }
      const rise = (Math.min(work, HOUSE_WORK_TICKS) / HOUSE_WORK_TICKS) * (top - base);
      const reach = side / 2 - POST_WIDTH / 2;
      for (let corner = 0; corner < POSTS_PER_SITE; corner++) {
        const index = frames * POSTS_PER_SITE + corner;
        put(posts, index, x + (corner & 1 ? reach : -reach), base, z + (corner & 2 ? reach : -reach), POST_WIDTH, rise, POST_WIDTH);
        const along = corner < 2;
        const offset = corner % 2 === 0 ? -reach : reach;
        put(
          beams,
          index,
          x + (along ? 0 : offset),
          base + Math.max(rise - BEAM_WIDTH, 0),
          z + (along ? offset : 0),
          along ? side : BEAM_WIDTH,
          BEAM_WIDTH,
          along ? BEAM_WIDTH : side,
        );
      }
      frames++;
    }
    for (const [mesh, count] of [
      [posts, frames * POSTS_PER_SITE],
      [beams, frames * POSTS_PER_SITE],
      [walls, houses],
      [roofs, houses],
    ] as const) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  return { group, show };
}
