// GraphifyTool (stub: plan 01-13 RED).
import { err } from '../../domain/result.ts';
import type { Result } from '../../domain/result.ts';
import type { CapabilityDescriptor } from '../../ports/capability.ts';
import type { CommandExecutor } from '../../ports/command-executor.ts';
import type { GraphBuild, GraphData, GraphInstallFiles, GraphTool, LocatedGraphTool } from '../../ports/graph-tool.ts';

export interface GraphifyToolOptions {
  env?: NodeJS.ProcessEnv;
  dataRoot: string;
  home: string;
}

const NOT_IMPLEMENTED = { kind: 'unavailable', cause: 'not implemented' } as const;

export class GraphifyTool implements GraphTool {
  readonly descriptor: CapabilityDescriptor = { port: 'graph-tool', adapter: 'graphify', version: '0.9', capabilities: {}, offline: true };

  constructor(_executor: CommandExecutor, _options: GraphifyToolOptions) {}

  locate(): Promise<Result<LocatedGraphTool>> {
    return Promise.resolve(err(NOT_IMPLEMENTED));
  }
  extractCode(_stagingPath: string, _outDir: string): Promise<Result<GraphBuild>> {
    return Promise.resolve(err(NOT_IMPLEMENTED));
  }
  cluster(_outDir: string): Promise<Result<GraphBuild>> {
    return Promise.resolve(err(NOT_IMPLEMENTED));
  }
  readGraph(_file: string): Result<GraphData> {
    return err(NOT_IMPLEMENTED);
  }
  install(_stagingPath: string, _files: GraphInstallFiles): Result<string[]> {
    return err(NOT_IMPLEMENTED);
  }
}
