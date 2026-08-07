// The three managers are imported straight out of the Electron app's source
// tree. They import only fs/path/https/child_process/os/util — no `electron` —
// so they run unmodified in the extension host. This file is the single place
// that reaches across into ../src/main; nothing else should.
import { NodeManager } from '../../src/main/nodeManager'
import { JdkManager } from '../../src/main/jdkManager'
import { PortManager } from '../../src/main/portManager'

export const nodeManager = new NodeManager()
export const jdkManager = new JdkManager()
export const portManager = new PortManager()

export type Tool = 'node' | 'java'

export type Vm = typeof nodeManager | typeof jdkManager

export interface ToolMeta {
  key: Tool
  noun: string
  vm: Vm
  icon: string
  /** Where releases are downloaded from — shown in the Install New view. */
  source: string
  /**
   * Files a repo may commit to declare the version it needs, checked in order.
   * A workspace pin set through the UI takes precedence over these.
   */
  versionFiles: string[]
}

export const NODE: ToolMeta = {
  key: 'node',
  noun: 'Node',
  vm: nodeManager,
  icon: 'symbol-event',
  source: 'nodejs.org',
  versionFiles: ['.nvmrc', '.node-version'],
}

export const JDK: ToolMeta = {
  key: 'java',
  noun: 'JDK',
  vm: jdkManager,
  icon: 'coffee',
  source: 'Adoptium',
  versionFiles: ['.java-version', '.jdkversion'],
}

export const TOOLS: ToolMeta[] = [NODE, JDK]

export function toolByKey(key: Tool): ToolMeta {
  return key === 'node' ? NODE : JDK
}
