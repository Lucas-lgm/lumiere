/**
 * Mount path type definitions
 */

/**
 * Mount path interface
 */
export interface MountPath {
  /** Unique mount path ID */
  id: string
  /** Path */
  path: string
  /** Resource count */
  resourceCount: number
  /** Last scan time */
  lastScanned?: Date
  /** Whether to enable auto-scan */
  autoScan?: boolean
}
