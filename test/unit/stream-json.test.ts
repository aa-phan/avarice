// parseStreamJson and StreamJsonParser (Pitfall 10, "Stream-json outcome classification inputs"): the line parser
// the host adapter feeds while the process runs. It must tolerate chunking and garbage, and it must not carry
// model text into the facts the classifier reads.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { StreamJsonParser, parseStreamJson } from '../../src/adapters/host-claude/stream-json.ts';
import { apiError, hookBlock, maxBudget, success, transcript } from '../fixtures/stream-json.ts';

const SESSION = '3f2b8c1e-5a47-4d0b-9c1a-0e5d6f7a8b9c';

function chunked(text: string, size: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

describe('parseStreamJson', () => {
  it('returns the init event and the single final result of a finished run', () => {
    const parsed = parseStreamJson(transcript('success', SESSION));
    assert.equal(parsed.init?.sessionId, SESSION);
    assert.equal(parsed.init?.model, 'claude-haiku-5-5');
    assert.equal(parsed.init?.permissionMode, 'dontAsk');
    assert.deepEqual(parsed.init?.agents, ['gsd-codebase-mapper']);
    assert.equal(parsed.resultCount, 1);
    assert.deepEqual(parsed.result, {
      isError: false,
      subtype: 'success',
      terminalReason: 'completed',
      permissionDenials: [],
      totalCostUsd: 0.01606839,
      numTurns: 2,
      durationMs: 4726,
      sessionId: SESSION,
      subagentStats: { spawned: 1, completed: 1, failed: 0, refused: 0 },
    });
    assert.deepEqual(parsed.permissionDenied, []);
    assert.equal(parsed.malformedLines, 0);
  });

  it('gives the same facts however the output is chunked, including a split inside a line', () => {
    const whole = parseStreamJson(success);
    for (const size of [1, 7, 64, 1000]) {
      const parser = new StreamJsonParser();
      for (const piece of chunked(success, size)) parser.push(piece);
      assert.deepEqual(parser.finish(), whole, `chunk size ${size}`);
    }
  });

  it('decodes a multi-byte character that is split across two byte chunks', () => {
    const text = `{"type":"system","subtype":"init","session_id":"s","model":"modèle-é"}\n`;
    const bytes = Buffer.from(text, 'utf8');
    const cut = bytes.indexOf(0xc3) + 1;
    const parser = new StreamJsonParser();
    parser.push(bytes.subarray(0, cut));
    parser.push(bytes.subarray(cut));
    assert.equal(parser.finish().init?.model, 'modèle-é');
  });

  it('reads a final line that has no trailing newline', () => {
    const noNewline = success.replace(/\n$/, '');
    assert.equal(parseStreamJson(noNewline).result?.subtype, 'success');
  });

  it('tolerates a partial trailing line: it is counted, never thrown, and gives no result', () => {
    const cut = success.slice(0, success.lastIndexOf('{"type":"result"') + 40);
    const parsed = parseStreamJson(cut);
    assert.equal(parsed.result, undefined);
    assert.equal(parsed.resultCount, 0);
    assert.equal(parsed.malformedLines, 1);
    assert.equal(parsed.init?.sessionId, '{{SESSION}}');
  });

  it('keeps is_error and terminal_reason, so subtype success with an api_error is not a success', () => {
    const { result } = parseStreamJson(apiError);
    assert.equal(result?.subtype, 'success');
    assert.equal(result?.isError, true);
    assert.equal(result?.terminalReason, 'api_error');
  });

  it('reads the budget result', () => {
    const { result } = parseStreamJson(maxBudget);
    assert.equal(result?.subtype, 'error_max_budget_usd');
    assert.equal(result?.terminalReason, 'budget_exhausted');
    assert.equal(result?.totalCostUsd, 0.4021);
    assert.equal(result?.numTurns, 14);
  });

  it('collects every permission_denied event and the result denials by tool name, without the tool input', () => {
    const parsed = parseStreamJson(hookBlock);
    assert.deepEqual(parsed.permissionDenied, [{ tool: 'Bash', reason: 'permission_denied' }]);
    assert.deepEqual(parsed.result?.permissionDenials, [{ tool: 'Bash', reason: 'permission_denied' }]);
    assert.ok(!JSON.stringify(parsed).includes('example.invalid'), 'the denied command is not carried');
  });

  it('reads the reason code of the real 2.1.316 permission_denied event (recorded live in plan 01-16) and drops its long message', () => {
    const event = JSON.stringify({
      type: 'system',
      subtype: 'permission_denied',
      tool_name: 'Write',
      tool_use_id: 'toolu_01',
      decision_reason_type: 'mode',
      message: "Permission to use Write has been denied because Claude Code is running in don't ask mode. IMPORTANT: ...",
      uuid: 'd5f40fc7-7e2b-4743-a763-448d29d2efb1',
      session_id: SESSION,
    });
    const parsed = parseStreamJson(`${event}\n`);
    assert.deepEqual(parsed.permissionDenied, [{ tool: 'Write', reason: 'mode' }]);
    assert.ok(!JSON.stringify(parsed).includes("don't ask"), 'the host message is not carried');
  });

  it('counts garbage lines and keeps parsing the lines around them', () => {
    const mixed = `not json at all\n\n[1,2,3]\n"a string"\n${success}{"type":\n`;
    const parsed = parseStreamJson(mixed);
    assert.equal(parsed.malformedLines, 4);
    assert.equal(parsed.result?.subtype, 'success');
  });

  it('keeps the last result when the host prints more than one, and says how many there were', () => {
    const parsed = parseStreamJson(success + apiError);
    assert.equal(parsed.resultCount, 2);
    assert.equal(parsed.result?.isError, true);
  });

  it('does not carry model text: nothing the model wrote is in the parsed facts', () => {
    const parsed = parseStreamJson(success);
    const json = JSON.stringify(parsed);
    assert.ok(!json.includes('The scan finished'), 'the result text is not kept');
    assert.ok(!json.includes('I will run the scan'), 'assistant text is not kept');
    assert.equal('text' in (parsed.result ?? {}), false);
    assert.equal('result' in (parsed.result ?? {}), false);
  });

  it('coerces missing or invalid numbers to zero and never to NaN', () => {
    const bad = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 'a lot', num_turns: -3, duration_ms: null });
    const { result } = parseStreamJson(`${bad}\n`);
    assert.deepEqual([result?.totalCostUsd, result?.numTurns, result?.durationMs], [0, 0, 0]);
  });

  it('reports is_error as undefined when the result has no boolean is_error', () => {
    const { result } = parseStreamJson(`${JSON.stringify({ type: 'result', subtype: 'success' })}\n`);
    assert.equal(result?.isError, undefined);
  });

  it('drops a line above the size limit and goes on with the next one', () => {
    const parser = new StreamJsonParser({ maxLineBytes: 200 });
    parser.push(`${'x'.repeat(5000)}\n`);
    parser.push(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false })}\n`);
    const parsed = parser.finish();
    assert.equal(parsed.malformedLines, 1);
    assert.equal(parsed.result?.isError, false);
  });

  it('accepts an iterable of string and byte chunks as well as one string', () => {
    const asBytes = [Buffer.from(success.slice(0, 100)), success.slice(100, 500), Buffer.from(success.slice(500))];
    assert.deepEqual(parseStreamJson(asBytes), parseStreamJson(success));
  });
});
