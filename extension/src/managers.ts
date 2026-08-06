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
