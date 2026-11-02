// buildInvocationEnv: the invocation environment is rebuilt from an allowlist (SEC-5, CON-3, S0-C, S0-E).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildInvocationEnv } from '../../src/adapters/host-claude/env.ts';

const HOSTILE: Record<string, string> = {
  HTTPS_PROXY: 'http://proxy.example:3128',
  HTTP_PROXY: 'http://proxy.example:3128',
  ALL_PROXY: 'socks5://proxy.example:1080',
  https_proxy: 'http://proxy.example:3128',
  NO_PROXY: '*',
  NODE_TLS_REJECT_UNAUTHORIZED: '0',
  NODE_EXTRA_CA_CERTS: '/tmp/evil-ca.pem',
  SSL_CERT_FILE: '/tmp/evil-ca.pem',
  GEMINI_API_KEY: 'gk-secret',
  GOOGLE_API_KEY: 'gg-secret',
  ANTHROPIC_BASE_URL: 'https://evil.example',
  ANTHROPIC_API_KEY: 'sk-ant-secret',
  ANTHROPIC_AUTH_TOKEN: 'at-secret',
  OPENAI_API_KEY: 'sk-openai-secret',
  GH_TOKEN: 'ghp_secret',
  GITHUB_TOKEN: 'ghs_secret',
  AWS_SECRET_ACCESS_KEY: 'aws-secret',
  AWS_ACCESS_KEY_ID: 'AKIAAAAAAAAAAAAAAAAA',
  NPM_TOKEN: 'npm-secret',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  GIT_SSH_COMMAND: 'ssh -o ProxyCommand=evil',
  GIT_DIR: '/elsewhere',
  GIT_CONFIG_GLOBAL: '/evil/gitconfig',
  LD_PRELOAD: '/tmp/evil.so',
  DYLD_INSERT_LIBRARIES: '/tmp/evil.dylib',
  NODE_OPTIONS: '--require /tmp/evil.js',
  CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1',
  CLAUDE_CODE_USE_BEDROCK: '1',
  AVARICE_FAULT: 'after-transition:mapping',
  AVARICE_RUN: 'someone-elses-run',
  UNRELATED_SETTING: 'x',
};

const PARENT = {
  PATH: '/home/u/bin:/usr/local/bin:/usr/bin',
  HOME: '/home/u',
  LANG: 'en_US.UTF-8',
  TMPDIR: '/var/tmp/u',
  USER: 'u',
  LOGNAME: 'u',
  CLAUDE_CONFIG_DIR: '/home/u/.claude-edu',
  ...HOSTILE,
};

const OPTIONS = { gsdCoreBin: '/gsd/core/bin', onboardingId: 'onb-123' };

describe('buildInvocationEnv', () => {
  it('drops proxies, TLS overrides, model-backend keys and tokens from the parent environment', () => {
    const env = buildInvocationEnv(PARENT, OPTIONS);
    for (const name of Object.keys(HOSTILE)) {
      if (name === 'AVARICE_RUN') continue;
      assert.equal(env[name], undefined, `${name} must not reach the child`);
    }
    for (const [name, value] of Object.entries(env)) {
      for (const secret of ['gk-secret', 'gg-secret', 'ghp_secret', 'aws-secret', 'sk-ant-secret', 'proxy.example', 'evil']) {
        assert.ok(!`${name}=${value}`.includes(secret), `${name} carries ${secret}`);
      }
    }
  });

  it('puts the gsd-core bin first on PATH, then the system directories only', () => {
    const env = buildInvocationEnv(PARENT, OPTIONS);
    assert.equal(env['PATH'], '/gsd/core/bin:/usr/bin:/bin:/opt/homebrew/bin');
    assert.ok(!env['PATH']?.includes('/home/u/bin'));
  });

  it('passes HOME, LANG, TMPDIR, USER, LOGNAME and CLAUDE_CONFIG_DIR through when the parent sets them', () => {
    const env = buildInvocationEnv(PARENT, OPTIONS);
    assert.equal(env['HOME'], '/home/u');
    assert.equal(env['LANG'], 'en_US.UTF-8');
    assert.equal(env['TMPDIR'], '/var/tmp/u');
    assert.equal(env['USER'], 'u');
    assert.equal(env['LOGNAME'], 'u');
    assert.equal(env['CLAUDE_CONFIG_DIR'], '/home/u/.claude-edu');
  });

  it('sets CLAUDE_CONFIG_DIR only when the parent has it (no default is invented)', () => {
    const { CLAUDE_CONFIG_DIR: _omitted, ...rest } = PARENT;
    const env = buildInvocationEnv(rest, OPTIONS);
    assert.ok(!('CLAUDE_CONFIG_DIR' in env));
    assert.ok(!('CLAUDE_CONFIG_DIR' in buildInvocationEnv({ ...PARENT, CLAUDE_CONFIG_DIR: '' }, OPTIONS)));
  });

  it('carries the safe-git variables', () => {
    const env = buildInvocationEnv(PARENT, OPTIONS);
    assert.equal(env['GIT_CONFIG_COUNT'], '2');
    assert.equal(env['GIT_CONFIG_KEY_0'], 'core.hooksPath');
    assert.equal(env['GIT_CONFIG_VALUE_0'], '/dev/null');
    assert.equal(env['GIT_CONFIG_KEY_1'], 'core.fsmonitor');
    assert.equal(env['GIT_CONFIG_NOSYSTEM'], '1');
    assert.equal(env['GIT_TERMINAL_PROMPT'], '0');
    assert.equal(env['GIT_OPTIONAL_LOCKS'], '0');
    assert.equal(env['GIT_DIR'], undefined);
    assert.equal(env['GIT_CONFIG_GLOBAL'], undefined);
  });

  it('sets AVARICE_RUN to the onboarding id and ignores a value inherited from the parent', () => {
    assert.equal(buildInvocationEnv(PARENT, OPTIONS)['AVARICE_RUN'], 'onb-123');
  });

  it('keeps instruction files and auto memory out (S0-E) and never disables background tasks', () => {
    const env = buildInvocationEnv(PARENT, OPTIONS);
    assert.equal(env['CLAUDE_CODE_DISABLE_CLAUDE_MDS'], '1');
    assert.equal(env['CLAUDE_CODE_DISABLE_AUTO_MEMORY'], '1');
    assert.equal(env['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS'], undefined);
  });

  it('appends extra PATH directories (the graphify directory, knowledge pass only) after the system ones', () => {
    const env = buildInvocationEnv(PARENT, { ...OPTIONS, extraPath: ['/tools/graphify/bin'] });
    assert.equal(env['PATH'], '/gsd/core/bin:/usr/bin:/bin:/opt/homebrew/bin:/tools/graphify/bin');
  });

  it('returns only the allowlisted names, whatever the parent holds', () => {
    const allowed = new Set([
      'PATH', 'HOME', 'LANG', 'TMPDIR', 'USER', 'LOGNAME', 'CLAUDE_CONFIG_DIR', 'AVARICE_RUN',
      'CLAUDE_CODE_DISABLE_CLAUDE_MDS', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
      'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GIT_CONFIG_KEY_1', 'GIT_CONFIG_VALUE_1',
      'GIT_CONFIG_NOSYSTEM', 'GIT_ATTR_NOSYSTEM', 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT',
    ]);
    for (const name of Object.keys(buildInvocationEnv(PARENT, OPTIONS))) assert.ok(allowed.has(name), `unexpected ${name}`);
  });

  it('does not read or mutate the process environment, and does not alias the parent object', () => {
    const before = JSON.stringify(process.env);
    const parent = { ...PARENT };
    const env = buildInvocationEnv(parent, OPTIONS);
    assert.equal(JSON.stringify(process.env), before);
    assert.deepEqual(parent, PARENT);
    env['HOME'] = 'changed';
    assert.equal(parent.HOME, '/home/u');
  });
});
