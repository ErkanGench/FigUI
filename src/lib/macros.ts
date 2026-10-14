import { isLineInputHeldByJob, LINE_INPUT_HELD_BY_JOB, sendRaw } from './ws'
import { fetchFileContent } from './http'
import { useTerminalStore } from '../store/terminal'
import type { Macro } from '../types'

function reportMacro(macro: Macro, problem: string) {
  useTerminalStore.getState().appendLine(`[MSG:WARN: Macro "${macro.label || 'Unnamed'}" not run: ${problem}]`)
}

/** Sends a control's line; notes in the terminal when an SD job started here holds it back. */
export function sendControlLine(cmd: string, label: string) {
  if (sendRaw(cmd)) return true
  if (isLineInputHeldByJob()) useTerminalStore.getState().appendLine(`[MSG:WARN: ${label} not sent: ${LINE_INPUT_HELD_BY_JOB}]`)
  return false
}

export async function runMacro(macro: Macro): Promise<void> {
  // Not safe during every job: FluidNC would run the lines after an SD job
  // this page started, possibly long after the click.
  if (isLineInputHeldByJob()) {
    reportMacro(macro, LINE_INPUT_HELD_BY_JOB)
    return
  }
  let command = macro.command
  if (!command && macro.filename) {
    if (!macro.target) {
      reportMacro(macro, `no storage is set for ${macro.filename}`)
      return
    }
    try {
      const path = macro.target === 'SD' ? `/sd${macro.filename}` : macro.filename
      command = await fetchFileContent(path, macro.target === 'SD' ? 'sd' : 'local')
    } catch (e) {
      reportMacro(macro, `${macro.filename} could not be read (${e instanceof Error ? e.message : String(e)})`)
      return
    }
    if (!command.trim()) {
      reportMacro(macro, `${macro.filename} is empty`)
      return
    }
  }
  if (!command) return
  for (const line of command.split('\n').map(l => l.trim()).filter(Boolean)) {
    // Refused while a job stream owns the connection, while an SD job started
    // here holds the controller's input, during a reset, or while disconnected.
    if (!sendRaw(line)) {
      reportMacro(macro, isLineInputHeldByJob() ? LINE_INPUT_HELD_BY_JOB : 'the controller is busy or not connected')
      return
    }
  }
}

export const MACRO_BTN_CLASS: Record<Macro['color'], string> = {
  default: 'btn-ghost',
  accent:  'btn-accent-soft',
  ok:      'btn-ok',
  warn:    'btn-warn',
  danger:  'btn-danger',
  info:    'btn-info',
  purple:  'btn-purple',
  teal:    'btn-teal',
}
