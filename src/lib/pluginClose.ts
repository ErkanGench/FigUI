import { useMachineStore } from '../store'
import { sendRaw } from './ws'

// Lines plugins registered with setCloseCommand, for windows that are gone.
// They wait here until the controller takes G-code: connected and Idle (a jog
// or an alarm refuses them, and a dropped connection would lose them).
const pending: string[] = []

function flush() {
  const { connected, status } = useMachineStore.getState()
  while (pending.length && connected && status.state === 'Idle') {
    if (!sendRaw(pending[0])) return
    pending.shift()
  }
}

useMachineStore.subscribe(() => { if (pending.length) flush() })

/** Sends a closed plugin window's command now, or as soon as the controller can take it. */
export function sendCloseCommand(command: string) {
  pending.push(command)
  flush()
}
