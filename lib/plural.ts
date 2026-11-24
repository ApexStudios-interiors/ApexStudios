/**
 * "1 package", "2 packages", "0 packages". English only (i18n is out of scope
 * for v1, AGENTS.md), so the one rule is: exactly one takes the singular.
 * `plural` defaults to the singular plus "s"; pass it for anything irregular
 * ("1 entry", "2 entries").
 */
export function plural(count: number, singular: string, pluralForm: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
