import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('npm publish workflow is set up for trusted publishing provenance', async () => {
  const workflow = await readFile(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')
  assert.match(workflow, /id-token:\s*write/)
  assert.match(workflow, /runs-on:\s*ubuntu-latest/)
  assert.match(workflow, /tags:\s*\n\s*- 'v\*'/ )
  assert.match(workflow, /^ {6}- name: Publish\n {8}if: github\.event_name != 'workflow_dispatch'\n {8}run: \|/m)
  assert.match(workflow, /unset NODE_AUTH_TOKEN\n {10}npm publish\n/)
  assert.doesNotMatch(workflow, /registry-url/)
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN\s*:/)
  assert.doesNotMatch(workflow, /--provenance/)
})
