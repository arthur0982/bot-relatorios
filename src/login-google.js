const { abrirNavegador } = require('./scraper')

async function main() {
  const browser = await abrirNavegador({ headless: false })
  const [page] = await browser.pages()
  await page.goto('https://accounts.google.com/ServiceLogin?hl=pt-BR&continue=https://www.google.com/maps', {
    waitUntil: 'domcontentloaded',
  })

  console.log('Faça login na conta Google na janela que abriu.')
  console.log('Quando o Google Maps aparecer já conectado, feche a janela do navegador para salvar a sessão.')

  await new Promise((resolve) => browser.once('disconnected', resolve))
  console.log('Sessão salva em .puppeteer_perfil. Agora rode npm run agora.')
}

main().catch((erro) => {
  console.error(erro instanceof Error ? erro.message : erro)
  process.exit(1)
})
