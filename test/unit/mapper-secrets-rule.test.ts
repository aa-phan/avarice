// The mapper's secrets rule (plan 04-35, owner ruling 4): the map is validated with a secrets check, and a document that holds a credential-bearing value is rejected.
// The mapper contract never forbade writing one (the AC-14 run on GroceriesGPT quoted the repository's own development database URL and was blocked), so every map
// prompt now tells the mapper not to write such a value and to describe the setting instead. The check itself is unchanged. Pure functions; no host is started.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapperSecretsRule, restrictedMapPrompt, withMapperSecretsRule } from '../../src/domain/mapping.ts';
import { AVARICE_SECRET_PATTERNS, SECRET_KIND_DESCRIPTIONS, findSecrets, secretKinds } from '../../src/domain/secret-patterns.ts';
import { promptFor } from '../../src/app/stages/map.ts';

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

const MODES: ReadonlyArray<{ name: string; prompt: string }> = [
  { name: 'full', prompt: promptFor('full', undefined) },
  { name: 'full with an existing-map answer', prompt: promptFor('full', 'refresh') },
  { name: 'fast', prompt: promptFor('fast', undefined) },
  { name: 'fast with an existing-map answer', prompt: promptFor('fast', 'update') },
  { name: 'paths', prompt: promptFor('paths', undefined, ['src', 'lib/core']) },
  { name: 'paths with an existing-map answer', prompt: promptFor('paths', 'refresh', ['src']) },
];

describe('the mapper secrets rule', () => {
  it('names every kind the validation secrets check reports, read from the check own pattern list, and the list has no kind without a description', () => {
    const kinds = secretKinds();
    for (const { kind } of AVARICE_SECRET_PATTERNS) assert.ok(kinds.includes(kind), `the check kind ${kind} is in secretKinds()`);
    assert.ok(kinds.includes('gsd-scan'));
    const rule = mapperSecretsRule();
    assert.notEqual(rule, '');
    for (const kind of kinds) {
      const description = SECRET_KIND_DESCRIPTIONS[kind];
      assert.ok(typeof description === 'string' && description.length > 0, `kind ${kind} has a description`);
      assert.ok(rule.includes(description as string), `the rule names ${kind}: ${description}`);
    }
  });

  it('forbids writing a URL with userinfo and tells the mapper to describe the setting (its name and where it comes from) instead of quoting the value', () => {
    const rule = mapperSecretsRule();
    assert.match(rule, /never write/i);
    assert.match(rule, /user name and password before the host/i);
    assert.match(rule, /placeholder|development default|example/i);
    assert.match(rule, /describe the setting/i);
    assert.match(rule, /DATABASE_URL/);
    assert.match(rule, /mapper subagent/i);
  });

  it('is itself clean: the rule text carries nothing the secrets check would report, so a mapper that copies it into a document is not blocked by it', () => {
    assert.deepEqual(findSecrets(mapperSecretsRule()), []);
  });

  for (const { name, prompt } of MODES) {
    it(`is in the ${name} map prompt exactly once, after the command`, () => {
      assert.ok(prompt.startsWith('/gsd-map-codebase'), prompt);
      assert.equal(occurrences(prompt, mapperSecretsRule()), 1, prompt);
    });

    it(`is in the restricted ${name} map prompt exactly once, with the staged specs named`, () => {
      const restricted = restrictedMapPrompt(prompt);
      assert.equal(occurrences(restricted, mapperSecretsRule()), 1, restricted);
      assert.ok(restricted.startsWith(prompt), 'the prompt stays first');
      assert.ok(restricted.includes('.claude/gsd-core/workflows/map-codebase.md'));
    });
  }

  it('is added to a restricted prompt built from a bare command, and withMapperSecretsRule does not add it twice', () => {
    const bare = restrictedMapPrompt('/gsd-map-codebase --fast');
    assert.equal(occurrences(bare, mapperSecretsRule()), 1);
    const once = withMapperSecretsRule('/gsd-map-codebase');
    assert.equal(withMapperSecretsRule(once), once);
  });
});

describe('the validation secrets check is unchanged by the rule', () => {
  it('still reports a development database URL with userinfo, as the blocked GroceriesGPT run showed', () => {
    const hits = findSecrets('The default is postgresql://postgres:postgres@localhost:5432/recipecart for local runs.');
    assert.deepEqual(hits, [{ pattern: 'url-userinfo', line: 1 }]);
  });

  it('still reports each kind of its list', () => {
    assert.deepEqual(
      AVARICE_SECRET_PATTERNS.map((p) => p.kind),
      ['github-token', 'jwt', 'aws-key', 'private-key', 'authorization', 'url-userinfo'],
    );
    assert.deepEqual(findSecrets('see https://example.com/docs and DATABASE_URL in the environment'), []);
  });
});
