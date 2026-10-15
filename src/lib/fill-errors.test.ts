import { describe, expect, it } from 'vitest';
import {
  BusinessWebsiteRequiredError,
  BusinessContextTooEmptyError,
  NoActiveIcpError,
  StrategyNotSelectedError,
  SectionNotProposableError,
} from './errors.js';

describe('fill-agent refusals', () => {
  it('carries the catalogued code and a 400', () => {
    expect(new BusinessWebsiteRequiredError()).toMatchObject({ code: 'AUR-T0029', statusCode: 400 });
    expect(new BusinessContextTooEmptyError()).toMatchObject({ code: 'AUR-T0030', statusCode: 400 });
    expect(new NoActiveIcpError()).toMatchObject({ code: 'AUR-T0031', statusCode: 400 });
    expect(new StrategyNotSelectedError()).toMatchObject({ code: 'AUR-T0032', statusCode: 400 });
    expect(new SectionNotProposableError({ section: 'projects' })).toMatchObject({
      code: 'AUR-T0033',
      statusCode: 400,
    });
  });

  it('resolves localized copy rather than echoing the code', () => {
    // A message equal to the code means the locale file has no entry — the
    // founder would read "AUR-T0031" as the explanation.
    for (const error of [
      new BusinessWebsiteRequiredError(),
      new BusinessContextTooEmptyError(),
      new NoActiveIcpError(),
      new StrategyNotSelectedError(),
    ]) {
      expect(error.message).not.toBe(error.code);
      expect(error.message.length).toBeGreaterThan(10);
    }
  });

  it('interpolates the section name', () => {
    expect(new SectionNotProposableError({ section: 'campaigns' }).message).toContain('campaigns');
  });
});
