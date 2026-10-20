export function controllerFilesystem(path: string): 'sd' | 'local' {
  return /^\/sd(?:\/|$)/i.test(path) ? 'sd' : 'local'
}

export function controllerRunCommand(path: string): string {
  return `$${controllerFilesystem(path) === 'sd' ? 'SD' : 'LocalFS'}/Run=${path}`
}

function normalizePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
    .replace(/^(?:sd|localfs|spiffs|littlefs)\//i, '')
    .replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function controllerPathsMatch(runningPath: string, loadedPath: string): boolean {
  return controllerFilesystem(runningPath) === controllerFilesystem(loadedPath)
    && normalizePath(runningPath) === normalizePath(loadedPath)
}

/**
 * The loadable path of the file a status report's SD: field names. FluidNC
 * reports it with its /sd or /localfs mount; a bare name is on the SD card.
 */
export function runningFilePath(sdFilename: string) {
  const path = sdFilename.replace(/\\/g, '/')
  return /^\/(?:sd|localfs)\//i.test(path) ? path : `/sd/${path.replace(/^\/+/, '')}`
}

/** Whether the running file a status report names is the file at path: same filesystem and full path. */
export function isRunningFile(sdFilename: string, path: string | null | undefined) {
  return !!path && controllerPathsMatch(runningFilePath(sdFilename), path)
}
