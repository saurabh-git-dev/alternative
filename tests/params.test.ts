import { describe, expect, it } from 'vitest';
import { applyPreset, initialValues, matchingPreset, validate } from '../src/core/params';
import { ACTIONS } from '../src/actions';
import { compressPdf } from '../src/actions/pdf/compress';
import { protectPdf } from '../src/actions/pdf/protect';

describe('parameter resolution', () => {
  it('starts on the default preset', () => {
    const values = initialValues(compressPdf);
    expect(values.level).toBe('recommended');
    expect(matchingPreset(compressPdf, values)).toBe('recommended');
  });

  it('applies presets and detects custom values', () => {
    const extreme = applyPreset(compressPdf, 'extreme', initialValues(compressPdf));
    expect(matchingPreset(compressPdf, extreme)).toBe('extreme');
    expect(matchingPreset(compressPdf, { ...extreme, level: 'strong' })).toBeNull();
  });

  it('ignores saved values of the wrong type', () => {
    expect(initialValues(compressPdf, { grayscale: 'yes' }).grayscale).toBe(false);
  });

  it('validates dependent fields', () => {
    const errors = validate(protectPdf, { ...initialValues(protectPdf), password: 'secret', confirm: 'other' });
    expect(errors.confirm).toBeTruthy();
  });

  it('every action has valid defaults and unique ids', () => {
    expect(new Set(ACTIONS.map((a) => a.id)).size).toBe(ACTIONS.length);
    for (const action of ACTIONS) {
      const values = initialValues(action);
      const errors = validate(action, values);
      // Password fields are intentionally empty until the user types.
      for (const key of Object.keys(errors)) expect(['password', 'confirm']).toContain(key);
    }
  });
});
