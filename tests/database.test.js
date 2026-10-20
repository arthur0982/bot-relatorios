const { test } = require('node:test')
const assert = require('node:assert/strict')
const { panelDatabaseUrl, RETIRED_SHARED_PROJECT, checkDatabaseIdentity } = require('../src/database-identity')
const { protectBotClient } = require('../src/db')
const { databaseFailure } = require('../src/database-errors')

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

test('identity diagnosis distinguishes auth, network, permission, missing schema and installation failures without exposing raw errors', async () => {
  const privateText = 'postgresql://user:private-test-password@private-host/postgres SELECT private-query'
  const cases = [
    [{ errorCode: 'P1000', message: privateText }, 'DATABASE_AUTH_FAILED'],
    [{ name: 'PrismaClientInitializationError', errorCode: undefined, message: 'Authentication failed against database server ' + privateText }, 'DATABASE_AUTH_FAILED'],
    [{ message: 'FATAL: Tenant or user not found ' + privateText }, 'DATABASE_AUTH_FAILED'],
    [{ message: "Can't reach database server " + privateText }, 'DATABASE_UNREACHABLE'],
    [{ code: 'P1001', message: privateText }, 'DATABASE_UNREACHABLE'],
    [{ code: 'P1002', message: privateText }, 'DATABASE_CONNECTION_TIMEOUT'],
    [{ code: 'P1011', message: privateText }, 'DATABASE_TLS_FAILED'],
    [{ code: 'P1017', message: privateText }, 'DATABASE_CONNECTION_FAILED'],
    [{ code: 'P2010', meta: { code: '42501', message: privateText } }, 'DATABASE_PERMISSION_DENIED'],
    [{ code: 'P2010', meta: { code: '42P01', message: privateText } }, 'SCHEMA_NOT_PREPARED'],
    [{ code: 'P2010', meta: { code: '28P01', message: privateText } }, 'DATABASE_AUTH_FAILED'],
    [{ message: '@prisma/client did not initialize yet ' + privateText }, 'PRISMA_INSTALL_REQUIRED'],
    [{ code: 'MODULE_NOT_FOUND', message: privateText }, 'PRISMA_INSTALL_REQUIRED'],
    [{ code: 'unknown-private-code', message: privateText }, 'BOT_DATABASE_CHECK_FAILED'],
  ]
  for (const [error, code] of cases) {
    const result = databaseFailure(error)
    assert.equal(result.code, code)
    assert.equal(result.details.stage, 'identity_query')
    assert.equal(result.messagesSent, 0)
    assert.equal(result.writes, false)
    assert.doesNotMatch(JSON.stringify(result), /private-|postgresql:|SELECT /)
    const client = { $queryRawUnsafe: async () => { throw error } }
    await assert.rejects(checkDatabaseIdentity(client, identity), failure => {
      assert.equal(failure.code, code)
      const formatted = databaseFailure(failure, 'operational_reads')
      assert.equal(formatted.details.stage, 'identity_query')
      assert.equal(formatted.details.prismaCode, result.details.prismaCode)
      assert.equal(formatted.details.sqlState, result.details.sqlState)
      assert.doesNotMatch(JSON.stringify(formatted), /private-|postgresql:|SELECT /)
      return true
    })
  }
  const unexpected = databaseFailure({ code: 'WRONG_DATABASE', message: privateText, details: { stage: privateText, prismaCode: privateText, sqlState: privateText } }, 'client_initialization')
  assert.equal(unexpected.details.stage, 'client_initialization')
  assert.equal(unexpected.code, 'WRONG_DATABASE')
  assert.doesNotMatch(JSON.stringify(unexpected), /private-/)
})
