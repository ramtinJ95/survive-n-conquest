import { describe, expect, it, vi } from 'vitest';

const ENTRIES = ['./building', './carrying', './eating', './foraging', './gathering', './jobs', './needs', './sim', './stocking', './supplying', './tasks', './villagers', './workshops'];

describe('the task kinds', () => {
  it.each(ENTRIES)('are all defined, each with its job, when %s is the first module loaded', async (entry) => {
    vi.resetModules();
    await import(entry);
    const { TASK_KINDS } = await import('./tasks');
    expect(TASK_KINDS.map((kind) => typeof kind?.job)).toEqual(TASK_KINDS.map(() => 'number'));
  });
});
