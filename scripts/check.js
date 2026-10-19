require('dotenv').config({ quiet: true })
const { createBotDatabase } = require('../src/db')
let database
async function main() {
  database = createBotDatabase()
  await database.check()
  const enabled = await database.prisma.placa.count({ where: { tipo: 'GOOGLE', status: 'ATIVA', botAtivo: true, contrato: { is: { ativo: true } } } })
  await database.prisma.contrato.findMany({ take: 1, select: { id: true } })
  await database.prisma.botLog.findFirst({ select: { id: true } })
  console.log(JSON.stringify({ ok: true, identityMatches: true, schema: 'placas', enabledPlates: enabled, whatsappStarted: false, messagesSent: 0, writes: false }, null, 2))
}
main().catch(error => {
  const codes = ['IDENTITY_REQUIRED', 'INVALID_DATABASE_URL', 'SHARED_DATABASE_BLOCKED', 'UNRECOGNIZED_DATABASE_HOST', 'PROJECT_REF_REQUIRED', 'WRONG_SUPABASE_PROJECT', 'SCHEMA_NOT_PREPARED', 'WRONG_DATABASE']
  console.error(JSON.stringify({ ok: false, code: codes.includes(error.code) ? error.code : 'BOT_DATABASE_CHECK_FAILED', message: 'Confira projeto exclusivo, identidade e permissões da role placas_bot. Nenhum WhatsApp foi iniciado nem mensagem enviada.' }))
  process.exitCode = 1
}).finally(async () => { if (database) await database.prisma.$disconnect() })
