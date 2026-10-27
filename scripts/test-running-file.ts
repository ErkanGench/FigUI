import assert from 'node:assert/strict'
import { isRunningFile, runningFilePath } from '../src/lib/controllerFiles'

{
  // Only the file FluidNC reports running counts as the loaded preview's job:
  // filesystem and full path, not the name alone.
  assert.equal(isRunningFile('/sd/F-Cu-Lazer.nc', '/sd/F-Cu-Lazer.nc'), true)
  assert.equal(isRunningFile('/sd/f-cu-lazer.nc', '/sd/F-Cu-Lazer.nc'), true, 'FAT names are case-insensitive')
  assert.equal(isRunningFile('/sd/jobs/Maske.nc', '/sd/jobs/Maske.nc'), true)
  assert.equal(isRunningFile('/sd/Maske-Lazer.nc', '/sd/F-Cu-Lazer.nc'), false)
  assert.equal(isRunningFile('/sd/Maske-Lazer.nc', null), false, 'a preview with no controller path')
  assert.equal(isRunningFile('/sd/old/Maske.nc', '/sd/jobs/Maske.nc'), false, 'same name, other folder')
  assert.equal(isRunningFile('/sd/Maske.nc', '/sd/jobs/Maske.nc'), false, 'same name, other folder')
  assert.equal(isRunningFile('/localfs/Maske.nc', '/sd/Maske.nc'), false, 'same name, other filesystem')
  assert.equal(isRunningFile('/sd/Maske.nc', '/Maske.nc'), false, 'an internal-flash file is not the SD file')
  assert.equal(isRunningFile('/localfs/Maske.nc', '/Maske.nc'), true)
  assert.equal(isRunningFile('Maske.nc', '/sd/Maske.nc'), true, 'a bare name is on the SD card')
}

{
  // The Load button after a job from another device loads the file it ran.
  assert.equal(runningFilePath('/sd/jobs/Maske.nc'), '/sd/jobs/Maske.nc')
  assert.equal(runningFilePath('/localfs/a.nc'), '/localfs/a.nc')
  assert.equal(runningFilePath('Maske.nc'), '/sd/Maske.nc', 'a bare name is on the SD card')
  assert.equal(runningFilePath('/jobs/Maske.nc'), '/sd/jobs/Maske.nc')
}

console.log('Running file tests passed')
