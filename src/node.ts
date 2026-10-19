import { configurePlatform } from './platform/index.ts';
import { nodePlatform } from './platform/node/index.ts';

configurePlatform(nodePlatform());

export * from './runtime.ts';
export { nodeHostFs } from './platform/node/hostfs.ts';
