import { InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { Building, siteMidX, siteMidY } from '../sim/buildings';
import type { TileMap } from '../sim/map';
import { MAX_SITES, type Orders, SiteState } from '../sim/orders';
import { flameGeometry } from './camp';
import type { Shapes } from './shapes';
import { floorOf } from './sites';

/** The sign of a house whose fire burns: a flame standing this far over the roof's top, this many times the camp's flame. */
const SIGN = { over: 0.05, scale: 1.3 };

/**
 * The plain sign over each house whose fire burns tonight: a flame on the
 * roof, which the sun does not light, so it shows in the dark. One instanced
 * mesh draws them all.
 */
export function createFires(map: TileMap, shapes: Shapes) {
  shapes.house.computeBoundingBox();
  const roof = shapes.house.boundingBox!.max.y + SIGN.over;
  const half = map.size / 2;
  const mesh = new InstancedMesh(flameGeometry(), new MeshBasicMaterial({ vertexColors: true, toneMapped: false }), MAX_SITES);
  mesh.name = 'house fires';
  mesh.count = 0;
  mesh.frustumCulled = false;
  const placed = new Matrix4();

  /** Shows a sign over each finished house whose store's fire burns, from `fires`, one flag per store id. */
  const show = (orders: Orders, fires: Uint8Array) => {
    const { sites } = orders;
    let count = 0;
    for (let slot = 0; slot < sites.used; slot++) {
      if (fires[slot] !== 1 || sites.kind[slot] !== Building.House || sites.state[slot] !== SiteState.Built) continue;
      const x = siteMidX(sites, slot);
      const y = siteMidY(sites, slot);
      placed.makeScale(SIGN.scale, SIGN.scale, SIGN.scale).setPosition(x - half, floorOf(map, sites, slot) + roof, y - half);
      mesh.setMatrixAt(count++, placed);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  };

  return { mesh, show };
}
