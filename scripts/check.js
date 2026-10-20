require('dotenv').config({ quiet: true })
const { databaseFailure } = require('../src/database-errors')
let database
let stage = 'client_initialization'
async function main() {
  const { createBotDatabase } = require('../src/db')
  database = createBotDatabase()
  stage = 'identity_query'
  await database.check()
  stage = 'operational_reads'
  const enabled = await database.prisma.placa.count({ where: { tipo: 'GOOGLE', status: 'ATIVA', botAtivo: true, contrato: { is: { ativo: true } } } })
  await database.prisma.contrato.findMany({ take: 1, select: { id: true } })
  await database.prisma.botLog.findFirst({ select: { id: true } })
  console.log(JSON.stringify({ ok: true, identityMatches: true, schema: 'placas', enabledPlates: enabled, whatsappStarted: false, messagesSent: 0, writes: false }, null, 2))
}
main().catch(error => {
  console.error(JSON.stringify(databaseFailure(error, stage)))
  process.exitCode = 1
}).finally(async () => { if (database) await database.prisma.$disconnect().catch(() => {}) })
