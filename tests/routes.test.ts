import { describe, expect, it } from 'vitest';
import { describeRoute, parseRoute, sectionOfRoute } from '../src/ui/routes';

describe('routes', () => {
  it('finds tools, IT tools and pages', () => {
    expect(parseRoute('#/tool/pdf.merge', false).action?.id).toBe('pdf.merge');
    expect(parseRoute('#/tool/video.trim/recording/abc-1', false).recordingId).toBe('abc-1');
    const jwt = parseRoute('#/jwt/xyz', false);
    expect(jwt.itTool?.id).toBe('jwt');
    expect(jwt.itPayload).toBe('xyz');
    expect(parseRoute('#/connect/123', false).page).toBe('connect');
    expect(parseRoute('#/local', false).page).toBe('home');
    expect(parseRoute('#/local', true).page).toBe('local');
    expect(parseRoute('#/', false).page).toBe('home');
  });

  it('names a tab and its section', () => {
    const merge = parseRoute('#/tool/pdf.merge', false);
    expect(describeRoute(merge, 'home').title).toBe('Merge PDF');
    expect(sectionOfRoute(merge, 'home')).toBe('pdf');
    expect(sectionOfRoute(parseRoute('#/tool/video.trim', false), 'it')).toBe('video');
    expect(sectionOfRoute(parseRoute('#/uuid', false), 'home')).toBe('it');
    expect(describeRoute(parseRoute('#/', false), 'image').title).toBe('Image tools');
  });
});
