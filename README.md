# Bot semanal de relatórios das placas

Este processo lê avaliações do Google Maps e envia relatórios pelo WhatsApp Web. O painel fica no repositório `arthur0982/gerenciadorplacas`. Ambos usam um **novo projeto Supabase exclusivo das placas**; o CRM atual `zync-atualizado` usa seu SQLite separado.

Siga `REATIVACAO_DO_ZERO.md` no repositório do painel para criar banco, conta, roles e publicar. O painel é responsável pela estrutura. Este bot tem apenas um modelo de leitura parcial do schema `placas`: **não execute Prisma db push, migrate ou reset aqui**. Com a role correta, essas alterações são recusadas pelo PostgreSQL.

## Ambiente

Node 24 foi validado. Instale com `npm ci`, que também gera o Prisma Client. Configure privadamente:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão do novo Supabase com a role **placas_bot**, nunca proprietária nem do CRM |
| `PLATES_SUPABASE_PROJECT_REF` | ID público do novo projeto, igual ao painel |
| `PLATES_DATABASE_ID` | Identidade UUID do banco, igual ao painel |
| `USAR_GEMINI` | `false` para resumo local sem chamadas de IA; `true` se configurado |
| `GEMINI_API_KEY` | Somente se a IA estiver habilitada |
| `GEMINI_MODEL` | Modelo disponível para sua chave, quando habilitado |
| `HEADLESS` | Opcional: `false` para visualizar o Chrome de leitura |

O antigo projeto compartilhado é bloqueado pelo código antes da conexão, inclusive via pooler. O ID do novo projeto é conferido e a identidade do schema é checada antes das consultas. O bot só permite leitura operacional e criação de logs; a role específica também limita acesso no servidor. Ela não lê usuários, financeiro, Pix ou Wi-Fi e não altera placas/contratos nem apaga logs. Senhas administrativas não devem ficar neste ambiente.

## Diagnóstico e início

```powershell
npm.cmd run db:check
npm.cmd start
```

O diagnóstico não abre Chrome/WhatsApp nem envia mensagens. A base nova pode retornar zero placas habilitadas. Ao iniciar, autentique o QR no WhatsApp se solicitado. O bot verifica o banco antes de abrir o WhatsApp. Mantenha terminal/PC ligados: os relatórios estão agendados para sábado às 20h em `America/Sao_Paulo`. Só considera Google, status ATIVA, bot ligado e contrato ativo. Configure Place ID e WhatsApp no painel.

`npm run agora` **envia de verdade** e ignora a prevenção de reenvio do mesmo dia. Não use como diagnóstico. Teste primeiro com seu próprio telefone. `npm run login-google` permite login no Maps caso a leitura exija autenticação. A leitura externa e a entrega real precisam ser homologadas; um teste local de banco não confirma esses serviços.

Preserve `.wwebjs_auth` e `.puppeteer_perfil` privadamente. São sessões de navegador, não backups das placas. Não os envie ao GitHub/chat. Backups do banco pertencem ao painel, incluindo BotLog; mantenha cópia privada fora do computador.

## Validação de desenvolvimento

```bash
npm test
npm run test:integration
```

O segundo comando requer Docker e um checkout irmão `../gerenciadorplacas` atualizado, ou `PLATES_PANEL_CHECKOUT` apontando para ele. Cria/remove somente seu próprio PostgreSQL descartável, usa as tabelas e roles oficiais do painel e testa leitura/logs/permissões/identidade com o Prisma real do bot. Não carrega `.env` para conectar à produção, não inicia WhatsApp, não busca Google e não chama Gemini.

Em ambientes cloud com Chromium já instalado, instale com `PUPPETEER_SKIP_DOWNLOAD=true npm ci` e use `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium` apenas se esse executável existir. No Windows, a instalação normal baixa o navegador suportado pelo Puppeteer.
