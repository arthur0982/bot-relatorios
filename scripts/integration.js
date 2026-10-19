// Disposable PostgreSQL only; no .env, WhatsApp, Google or Gemini access.
const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const { randomBytes, randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const { createBotDatabase } = require('../src/db')
const { PrismaClient } = require('@prisma/client')

const name = 'placas-bot-test-' + randomUUID()
const password = randomBytes(32).toString('hex')
const dockerEnv = { ...process.env, POSTGRES_PASSWORD: password }
const docker = args => execFileSync('docker', args, { env: dockerEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
let started = false, admin, bot, raw
async function main() {
  const panel = process.env.PLATES_PANEL_CHECKOUT || path.resolve(__dirname, '../../gerenciadorplacas')
  const { newClient, initialize, configureBotRole } = await import(pathToFileURL(path.join(panel, 'scripts/panel-database.mjs')).href)
  docker(['run', '-d', '--name', name, '--memory=512m', '--cpus=1', '-p', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_DB=bot_test', 'postgres:17-alpine'])
  started = true
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'bot_test'], { stdio: 'ignore' }).status === 0) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  assert.ok(ready, 'Disposable database did not become ready')
  const port = docker(['port', name, '5432/tcp']).split(':').at(-1)
  const url = new URL(`postgresql://postgres:${password}@127.0.0.1:${port}/bot_test`)
  const identity = randomUUID()
  admin = newClient(url.href)
  await initialize(admin, identity, { fresh: true })
  const rolePassword = randomBytes(32).toString('hex')
  await configureBotRole(admin, identity, 'placas_bot', rolePassword)
  url.username = 'placas_bot'; url.password = rolePassword
  bot = createBotDatabase(url.href, identity)
  await bot.check()
  assert.deepEqual(await bot.prisma.placa.findMany(), [])
  const contract = await admin.contrato.create({ data: { nomeEmpresa: 'Synthetic Integration', telefoneContato: '5511999999999' } })
  const plate = await admin.placa.create({ data: { contratoId: contract.id, nomeEmpresa: contract.nomeEmpresa, tipo: 'GOOGLE', status: 'ATIVA', botAtivo: true, placeId: 'ChIJ_Synthetic', telefoneWhatsapp: '5511999999999', wifiSenha: 'private-test-only' } })
  const rows = await bot.prisma.placa.findMany({ where: { tipo: 'GOOGLE', status: 'ATIVA', botAtivo: true, contrato: { is: { ativo: true } } }, include: { contrato: true } })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, plate.id)
  assert.equal(rows[0].contrato.nomeEmpresa, contract.nomeEmpresa)
  assert.equal(Object.hasOwn(rows[0], 'wifiSenha'), false)
  await bot.prisma.botLog.create({ data: { placaId: plate.id, status: 'SUCESSO', resumo: 'Synthetic integration log. No WhatsApp sent.' } })
  assert.equal((await admin.botLog.findFirst()).placaId, plate.id)
  await assert.rejects(bot.prisma.placa.deleteMany(), /BOT_OPERATION_BLOCKED/)
  await assert.rejects(bot.prisma.$executeRawUnsafe('DROP SCHEMA placas CASCADE'), /BOT_OPERATION_BLOCKED/)
  const wrong = createBotDatabase(url.href, randomUUID())
  try { await assert.rejects(wrong.prisma.placa.count(), { code: 'WRONG_DATABASE' }) }
  finally { await wrong.prisma.$disconnect() }
  url.searchParams.set('schema', 'placas')
  raw = new PrismaClient({ datasources: { db: { url: url.href } } })
  for (const sql of ['SELECT * FROM placas."Usuario"', 'SELECT * FROM placas."RegistroFinanceiro"', 'SELECT "wifiSenha" FROM placas."Placa"', 'DROP TABLE placas."Placa" CASCADE', 'DELETE FROM placas."BotLog"'])
    await assert.rejects(raw.$queryRawUnsafe(sql))
  const check = spawnSync(process.execPath, ['scripts/check.js'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url.href, PLATES_DATABASE_ID: identity }, encoding: 'utf8' })
  assert.equal(check.status, 0)
  const result = JSON.parse(check.stdout)
  assert.equal(result.enabledPlates, 1)
  assert.equal(result.messagesSent, 0)
  assert.equal(await admin.botLog.count(), 1)
  console.log('BOT INTEGRATION OK: empty database, real restricted role, report query, shared log persistence, wrong identity refusal, forbidden reads/DDL/deletes and read-only diagnostic. No WhatsApp, Google or Gemini requests.')
}
main().catch(() => {
  console.error('BOT_INTEGRATION_FAILED: confira Docker e o checkout irmão gerenciadorplacas. Somente banco descartável foi utilizado; nenhuma exceção de conexão foi impressa.')
  process.exitCode = 1
}).finally(async () => {
  if (raw) await raw.$disconnect()
  if (bot) await bot.prisma.$disconnect()
  if (admin) await admin.$disconnect()
  if (started) docker(['rm', '-f', name])
})
