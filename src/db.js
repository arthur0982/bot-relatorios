const { PrismaClient } = require('@prisma/client')
const { panelDatabaseUrl, expectedIdentity, checkDatabaseIdentity } = require('./database-identity')

const reads = new Set(['findFirst', 'findUnique', 'findMany', 'count'])
function protectBotClient(client, identity) {
  return client.$extends({
    query: {
      async $allOperations({ model, operation, args, query }) {
        const allowed = ['Placa', 'Contrato', 'BotLog'].includes(model) && reads.has(operation) || model === 'BotLog' && operation === 'create'
        if (!allowed) throw new Error('BOT_OPERATION_BLOCKED: o bot só lê dados operacionais e insere logs; não administra o banco.')
        await checkDatabaseIdentity(client, identity)
        return query(args)
      },
    },
  })
}

function createBotDatabase(url = process.env.DATABASE_URL, identity = process.env.PLATES_DATABASE_ID) {
  identity = expectedIdentity(identity)
  const base = new PrismaClient({ datasources: { db: { url: panelDatabaseUrl(url) } } })
  const prisma = protectBotClient(base, identity)
  return { prisma, check: () => checkDatabaseIdentity(base, identity) }
}

// Lazy initialization lets read-only diagnostics and tests import the factory
// without opening a database or requiring production configuration.
let database
function current() { return database || (database = createBotDatabase()) }
const prisma = new Proxy({}, { get(_target, key) {
  const client = current().prisma
  const value = client[key]
  return typeof value === 'function' ? value.bind(client) : value
} })
module.exports = { prisma, checkDatabase: () => current().check(), disconnectDatabase: async () => { if (database) await database.prisma.$disconnect() }, createBotDatabase, protectBotClient }
