const { test } = require('node:test')
const assert = require('node:assert/strict')
const { panelDatabaseUrl, RETIRED_SHARED_PROJECT, checkDatabaseIdentity } = require('../src/database-identity')
const { protectBotClient } = require('../src/db')

const identity = '8c4f246c-4f56-4995-8064-bc78fc8b07f5'
test('bot pins direct/pooler Supabase connections and blocks the previous shared project without echoing passwords', () => {
  const project = 'abcdefghijklmnopqrst'
  for (const url of [
    `postgresql://placas_bot:private-test-password@db.${project}.supabase.co/postgres`,
    `postgresql://placas_bot.${project}:private-test-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  ]) {
    assert.equal(new URL(panelDatabaseUrl(url, project)).searchParams.get('schema'), 'placas')
    assert.throws(() => panelDatabaseUrl(url, ''), { code: 'PROJECT_REF_REQUIRED' })
    assert.throws(() => panelDatabaseUrl(url, 'z'.repeat(20)), { code: 'WRONG_SUPABASE_PROJECT' })
  }
  assert.throws(() => panelDatabaseUrl(`postgresql://postgres:private-test-password@db.${RETIRED_SHARED_PROJECT}.supabase.co/postgres`, project), error => error.code === 'SHARED_DATABASE_BLOCKED' && !error.message.includes('private-test-password'))
  assert.throws(() => panelDatabaseUrl('file:dev.db'), { code: 'INVALID_DATABASE_URL' })
})

test('bot refuses wrong database identity and all writes except log insertion before calling the query', async () => {
  const base = { $queryRawUnsafe: async () => [{ id: 1, application: 'gerenciadorplacas', instanceId: identity }], $extends: config => config }
  const operation = protectBotClient(base, identity).query.$allOperations
  let executed = 0
  const query = async () => ++executed
  await operation({ model: 'Placa', operation: 'findMany', args: {}, query })
  await operation({ model: 'BotLog', operation: 'create', args: {}, query })
  assert.equal(executed, 2)
  for (const [model, action] of [['Placa', 'deleteMany'], ['Placa', 'update'], ['Contrato', 'create'], ['Usuario', 'findMany'], ['BotLog', 'deleteMany'], [undefined, '$executeRawUnsafe']])
    await assert.rejects(operation({ model, operation: action, args: {}, query }), /BOT_OPERATION_BLOCKED/)
  base.$queryRawUnsafe = async () => [{ id: 1, application: 'other-app', instanceId: identity }]
  await assert.rejects(operation({ model: 'Placa', operation: 'findMany', args: {}, query }), { code: 'WRONG_DATABASE' })
  assert.equal(executed, 2)
  await assert.rejects(checkDatabaseIdentity(base, identity), { code: 'WRONG_DATABASE' })
})
