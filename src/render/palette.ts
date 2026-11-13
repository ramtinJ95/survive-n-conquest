import { Color } from 'three';

export const SKY_COLOR = 0x9fc9e8;

/** Every color of the world. The meshes copy them into vertex colors when the world is built. */
export const PALETTE = {
  grassLow: new Color(0x7fae4c),
  grassHigh: new Color(0xb4bb66),
  meadow: new Color(0xa6c659),
  forestFloor: new Color(0x4d7b3b),
  rockLow: new Color(0x8c887d),
  rockHigh: new Color(0xb3afa4),
  sand: new Color(0xd9c68e),
  lakeBed: new Color(0x2c4a4c),
  water: new Color(0x3d8fbd),
  soil: new Color(0x86623f),
  bedrock: new Color(0x4b3524),
  trunk: new Color(0x6e4b2e),
  pineLow: new Color(0x2b5a3a),
  pineHigh: new Color(0x377349),
  leafLow: new Color(0x5c9a3d),
  leafHigh: new Color(0x78b04a),
  boulder: new Color(0x99958b),
};
