// Generates the five inputs one contained invocation launches with, in its own directory under the data root:
//
//   {dataRoot}/onboard/{onb}/{purpose}-{inv}/
//     host-settings.json   the permission and sandbox settings and the hook entries (renderClaudeSettings)
//     hook-policy.json     what the hook decides against (writeHookPolicy), with the GSD preamble fingerprint
//     agents.json          the agents the invocation may start (buildAgentsJson)
//     plugin/              the skills it may load, as links (buildPluginDir)
//     mcp.json             {"mcpServers":{}}: no MCP server loads (`--strict-mcp-config`)
//
// Files are 0600 and directories 0700, written by temp-and-rename so a reader never sees half of a file. The data
// root is in the sandbox's denyRead and outside every write root, the settings file is a protected path and the
// ConfigChange hook refuses edits, so the invocation can neither read nor change any of this (T-01-41).
import { chmodSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { err, ok } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { InvocationScope } from '../../domain/invocation-scope.ts';
import type { InvocationRequest } from '../../ports/agent-host.ts';
import { buildAgentsJson } from '../gsd/agents-json.ts';
import { buildPluginDir } from '../gsd/plugin-dir.ts';
import { avariceHookCommand, gsdSecretReadGuardHook, renderClaudeSettings } from './settings.ts';
import { writeHookPolicy } from './hook-policy.ts';
import type { PreambleFingerprint } from './hook-policy.ts';

export const SETTINGS_FILE = 'host-settings.json';
export const AGENTS_FILE = 'agents.json';
export const PLUGIN_DIR = 'plugin';
export const MCP_FILE = 'mcp.json';

export interface GsdLocations {
  gsdCoreDir: string;
  // Where GSD's agent definitions live ({gsdCoreDir}/../agents).
  agentsDir: string;
  // `{CLAUDE_CONFIG_DIR or ~/.claude}/skills`: the skills the plugin directory links.
  skillsRoot: string;
  // The Claude configuration directory, for GSD's secret read guard hook (kept when the directory has it).
  configDir?: string;
}

export interface InvocationFilesInput {
  invDir: string;
  scope: InvocationScope;
  request: Pick<InvocationRequest, 'onboardingId' | 'runId' | 'invocationId' | 'extensions'>;
  gsd: GsdLocations;
  // `src/hook/pre-tool-use.ts`, the script the generated settings run.
  hookEntry: string;
  // The ledger the hook records its decisions in.
  ledgerPath: string;
  preamble?: PreambleFingerprint;
}

export interface InvocationFiles {
  invDir: string;
  settingsFile: string;
  policyFile: string;
  agentsFile: string;
  pluginDir: string;
  mcpFile: string;
}

function writeAtomic(path: string, text: string): void {
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
}

// Creates `dir` and every missing parent below `root`, each 0700.
function privateDirs(root: string, dir: string): void {
  const missing: string[] = [];
  for (let at = dir; at.length > root.length && !existsSync(at); at = join(at, '..')) missing.unshift(at);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const created of missing) chmodSync(created, 0o700);
}

export function writeInvocationFiles(input: InvocationFilesInput): Result<InvocationFiles> {
  const { invDir, scope, request, gsd } = input;
  const files: InvocationFiles = {
    invDir,
    settingsFile: join(invDir, SETTINGS_FILE),
    policyFile: join(invDir, 'hook-policy.json'),
    agentsFile: join(invDir, AGENTS_FILE),
    pluginDir: join(invDir, PLUGIN_DIR),
    mcpFile: join(invDir, MCP_FILE),
  };

  try {
    privateDirs(scope.dataRoot, invDir);
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot create ${invDir}: ${(e as NodeJS.ErrnoException).code ?? 'mkdir failed'}` });
  }

  // The policy first: the settings name it, and the hook reads it on every call.
  const policy = writeHookPolicy(
    invDir,
    scope,
    { onboardingId: request.onboardingId, runId: request.runId, invocationId: request.invocationId, subagentTypes: request.extensions.agents },
    input.ledgerPath,
    input.preamble,
  );
  if (!policy.ok) return policy;

  const agents = buildAgentsJson(gsd.agentsDir, request.extensions.agents, files.agentsFile);
  if (!agents.ok) return agents;
  const plugin = buildPluginDir(files.pluginDir, gsd.skillsRoot, request.extensions.skills);
  if (!plugin.ok) return plugin;

  const guard = gsd.configDir === undefined ? null : gsdSecretReadGuardHook(gsd.configDir);
  const settings = renderClaudeSettings(scope, {
    hook: avariceHookCommand(input.hookEntry),
    policyFile: files.policyFile,
    ...(guard !== null ? { gsdHooks: [guard] } : {}),
    skillsAllowed: plugin.value.skills,
  });
  try {
    writeAtomic(files.settingsFile, JSON.stringify(settings, null, 2) + '\n');
    writeAtomic(files.mcpFile, JSON.stringify({ mcpServers: {} }) + '\n');
    chmodSync(files.pluginDir, 0o700);
  } catch (e) {
    return err({ kind: 'unavailable', cause: `cannot write the invocation files in ${invDir}: ${(e as NodeJS.ErrnoException).code ?? 'write failed'}` });
  }
  return ok(files);
}
