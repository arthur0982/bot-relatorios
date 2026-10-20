const { test } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { once } = require('node:events')
const { mkdtemp, writeFile, readFile, rm } = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { inspectConnections, probeNetwork, checkNetwork } = require('../src/network-check')

const ref = 'abcdefghijklmnopqrst', identity = '8c4f246c-4f56-4995-8064-bc78fc8b07f5'
function config(role, host = 'aws-0-us-east-1.pooler.supabase.com', port = 5432) {
  const url = new URL(`postgresql://${host}:${port}/postgres?sslmode=require&private-option=private-query-value`)
  url.username = `${role}.${ref}`; url.password = 'private-password-with-@-characters'
  return { found: true, values: { DATABASE_URL: url.href, PLATES_SUPABASE_PROJECT_REF: ref, PLATES_DATABASE_ID: identity, GEMINI_API_KEY: 'private-api-key' } }
}

test('connection comparison reveals only approved endpoint metadata and differences, never credentials or query values', () => {
  const bot = config('placas_bot'), panel = config('placas_app')
  const result = inspectConnections(bot, panel)
  assert.equal(result.bot.expectedRole, true)
  assert.equal(result.panel.expectedRole, true)
  assert.equal(result.bot.connectionType, 'session_pooler')
  assert.ok(Object.values(result.comparison).every(Boolean))
  assert.ok(Object.values(result.environmentOverridesFile).every(value => value === false))
  assert.doesNotMatch(JSON.stringify(result), /private-|postgresql:|placas_bot\./)
  const changed = config('placas_bot', 'aws-1-eu-west-1.pooler.supabase.com', 6543)
  const mismatch = inspectConnections(bot, panel, { DATABASE_URL: changed.values.DATABASE_URL })
  assert.equal(mismatch.environmentOverridesFile.DATABASE_URL, true)
  assert.equal(mismatch.comparison.sameHost, false)
  assert.equal(mismatch.comparison.samePort, false)
  assert.equal(mismatch.bot.connectionType, 'transaction_pooler')
  const unsafe = inspectConnections({ found: true, values: { ...bot.values, DATABASE_URL: 'postgresql://private:private-password@private-host.invalid/postgres' } }, panel)
  assert.equal(unsafe.bot.valid, false)
  assert.doesNotMatch(JSON.stringify(unsafe), /private-|postgresql:/)
})

test('network report reads only explicit fixture files, deduplicates equal targets and never rewrites configuration', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bot-network-fixture-'))
  try {
    const botFile = path.join(directory, 'bot.env'), panelFile = path.join(directory, 'panel.env')
    const encode = source => Object.entries(source.values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n')
    const botBody = encode(config('placas_bot')), panelBody = encode(config('placas_app'))
    await writeFile(botFile, botBody); await writeFile(panelFile, panelBody)
    let probes = 0
    const probe = async target => { probes++; assert.equal(target.port, 5432); return { dns: { ok: true, ipv4Available: true, ipv6Available: false }, tcp: { ok: true } } }
    const report = await checkNetwork({ botFile, panelFile, probe })
    assert.equal(probes, 1)
    assert.equal(report.readOnly, true)
    assert.equal(report.databaseOpened, false)
    assert.equal(report.sqlExecuted, false)
    assert.equal(report.messagesSent, 0)
    assert.equal(report.bot.network.tcp.ok, true)
    assert.doesNotMatch(JSON.stringify(report), /private-|postgresql:/)
    assert.equal(await readFile(botFile, 'utf8'), botBody)
    assert.equal(await readFile(panelFile, 'utf8'), panelBody)
    const missing = await checkNetwork({ botFile: path.join(directory, 'absent.env'), panelFile, probe })
    assert.equal(missing.bot.code, 'CONFIG_FILE_NOT_FOUND')
    assert.equal(missing.comparison, null)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('DNS/TCP probe connects to an owned loopback server without sending payloads and identifies a closed port', async () => {
  let bytes = 0
  const server = net.createServer(socket => { socket.on('data', data => { bytes += data.length }); socket.end() })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const target = { host: '127.0.0.1', port: server.address().port }
  try {
    const result = await probeNetwork(target, 1000)
    assert.equal(result.dns.ok, true)
    assert.equal(result.dns.ipv4Available, true)
    assert.equal(result.tcp.ok, true)
  } finally { await new Promise(resolve => server.close(resolve)) }
  assert.equal(bytes, 0)
  const closed = await probeNetwork(target, 1000)
  assert.equal(closed.dns.ok, true)
  assert.equal(closed.tcp.ok, false)
  assert.ok(['ECONNREFUSED', 'TIMEOUT'].includes(closed.tcp.code))
})
