import { describe, expect, it } from 'vitest';
import { getAction } from '../src/actions';
import { PIPELINE_ACTIONS, RECIPES, decodePipeline, encodePipeline, newStep, pipelineErrors, planTypes, runPipeline, type Pipeline } from '../src/core/pipeline';
import type { OutputFile } from '../src/core/types';

const step = (id: string) => newStep(getAction(id)!);

describe('pipelines', () => {
  it('leaves out hands-on tools', () => {
    const ids = PIPELINE_ACTIONS.map((a) => a.id);
    expect(ids).toContain('pdf.compress');
    for (const id of ['pdf.organize', 'pdf.sign', 'pdf.redact', 'pdf.fill-form', 'image.crop']) expect(ids).not.toContain(id);
  });

  it('follows file types through the steps', () => {
    const p: Pipeline = { name: 't', steps: [step('pdf.from-images'), step('pdf.ocr'), step('pdf.to-images'), step('image.convert')] };
    const plans = planTypes(p, ['image/png', 'image/jpeg']);
    expect(plans.map((s) => s.outputs)).toEqual([['application/pdf'], ['application/pdf'], ['image/jpeg'], ['image/webp']]);
    expect(pipelineErrors(p, ['image/png']).size).toBe(0);
  });

  it('flags a step that cannot take the previous output', () => {
    const p: Pipeline = { name: 't', steps: [step('pdf.to-images'), step('pdf.compress')] };
    expect(pipelineErrors(p, ['application/pdf']).get(1)).toMatch(/can't take JPG/);
  });

  it('recipes are valid and round-trip through links without passwords', () => {
    for (const r of RECIPES) {
      const p = r.pipeline();
      const first = getAction(p.steps[0].actionId)!.accepts[0].replace('image/*', 'image/jpeg');
      const errors = pipelineErrors(p, [first]);
      // Only "Protect PDF" may complain: its password is never stored.
      expect([...errors.keys()].every((i) => p.steps[i].actionId === 'pdf.protect')).toBe(true);
    }
    const p = RECIPES.find((r) => r.id === 'send-pdf')!.pipeline();
    p.steps[2].params.password = 'secret';
    const back = decodePipeline(encodePipeline(p))!;
    expect(back.steps.map((s) => s.actionId)).toEqual(p.steps.map((s) => s.actionId));
    expect(back.steps[2].params.password).toBe('');
    expect(decodePipeline('garbage')).toBeNull();
  });

  it('runs steps in order and maps outputs back to their original file', async () => {
    const p: Pipeline = { name: 't', steps: [step('pdf.split'), step('pdf.compress')] };
    const files = [0, 1].map((i) => ({ name: `f${i}.pdf`, type: 'application/pdf', bytes: new Uint8Array(10 + i) }));
    const calls: string[] = [];
    const out = await runPipeline(p, files, async (action, input) => {
      calls.push(`${action.id}:${input.length}`);
      // Fake runner: split makes two files per input; compress passes through.
      const per = action.id === 'pdf.split' ? 2 : 1;
      return input.flatMap((f, i) => Array.from({ length: per }, (): OutputFile => ({ ...f, inputIndex: i })));
    }, () => {});
    expect(calls).toEqual(['pdf.split:2', 'pdf.compress:4']);
    expect(out.map((o) => o.inputIndex)).toEqual([0, 0, 1, 1]);
    expect(out.map((o) => o.inputSize)).toEqual([10, 10, 11, 11]);
  });
});
