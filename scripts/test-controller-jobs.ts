import assert from 'node:assert/strict'
import { isJobActiveState, isRunningFile, jobContinues, runningFilePath } from '../src/lib/controllerFiles'

{
  // A running file is matched by filesystem and full path, not by its name.
  assert.equal(isRunningFile('/sd/jobs/a.nc', '/sd/jobs/a.nc'), true)
  assert.equal(isRunningFile('/sd/Jobs/A.NC', '/sd/jobs/a.nc'), true, 'FAT names are case-insensitive')
  assert.equal(isRunningFile('/sd/a.nc', '/sd/jobs/a.nc'), false, 'same name, other folder')
  assert.equal(isRunningFile('/sd/old/a.nc', '/sd/new/a.nc'), false, 'same name, other folder')
  assert.equal(isRunningFile('/localfs/a.nc', '/sd/a.nc'), false, 'same name, other filesystem')
  assert.equal(isRunningFile('/sd/a.nc', '/a.nc'), false, 'an internal-flash file is not the SD file')
  assert.equal(isRunningFile('/localfs/a.nc', '/a.nc'), true)
  assert.equal(isRunningFile('a.nc', '/sd/a.nc'), true, 'a bare name is on the SD card')
  assert.equal(isRunningFile('/sd/a.nc', null), false, 'a preview with no controller path')
  assert.equal(runningFilePath('jobs/a.nc'), '/sd/jobs/a.nc')
}

{
  // Door pauses a job like Hold.
  assert.deepEqual(['Run', 'Hold', 'Door', 'Idle', 'Alarm', 'Jog'].map(isJobActiveState), [true, true, true, false, false, false])
}

{
  // After a dropped connection, only the same file in a job state continues the job.
  assert.equal(jobContinues('Run', '/sd/jobs/a.nc', '/sd/jobs/a.nc'), true)
  assert.equal(jobContinues('Door', '/sd/jobs/a.nc', '/sd/jobs/a.nc'), true, 'a safety-door pause still runs it')
  assert.equal(jobContinues('Idle', undefined, '/sd/jobs/a.nc'), false, 'it ended or the controller restarted')
  assert.equal(jobContinues('Run', '/sd/jobs/b.nc', '/sd/jobs/a.nc'), false, 'another device started another file')
  assert.equal(jobContinues('Run', '/sd/other/a.nc', '/sd/jobs/a.nc'), false, 'same name in another folder')
  assert.equal(jobContinues('Run', '/localfs/a.nc', '/sd/a.nc'), false, 'same name on another filesystem')
  assert.equal(jobContinues('Run', undefined, '/sd/a.nc'), false, 'no file runs any more')
  assert.equal(jobContinues('Hold', undefined, null), true, 'a job seen without a file is judged by its state')
}

console.log('Controller job tests passed')
