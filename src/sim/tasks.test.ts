import { describe, expect, it, vi } from 'vitest';

const ENTRIES = ['./building', './carrying', './gathering', './needs', './sim', './stocking', './supplying', './tasks', './villagers'];

describe('the task kinds', () => {
  it.each(ENTRIES)('are all defined when %s is the first module loaded', async (entry) => {
    vi.resetModules();
    await import(entry);
    const { TASK_KINDS } = await import('./tasks');
    expect(TASK_KINDS.map((kind) => typeof kind?.take)).toEqual(TASK_KINDS.map(() => 'function'));
  });
});
