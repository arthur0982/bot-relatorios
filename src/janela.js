function parte(partes, tipo) {
  return partes.find((item) => item.type === tipo)?.value ?? ''
}

function calendarioBrasilia(data) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(data)

  return {
    ano: Number(parte(partes, 'year')),
    mes: Number(parte(partes, 'month')),
    dia: Number(parte(partes, 'day')),
  }
}

function meiaNoiteBrasilia({ ano, mes, dia }) {
  return new Date(Date.UTC(ano, mes - 1, dia, 3, 0, 0))
}

function inicioJanelaAvaliacoes(agora = new Date()) {
  const seteDiasAntes = new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000)
  return meiaNoiteBrasilia(calendarioBrasilia(seteDiasAntes))
}

function inicioDoDiaBrasilia(agora = new Date()) {
  return meiaNoiteBrasilia(calendarioBrasilia(agora))
}

function formatarDataHora(valor) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(valor))
}

function normalizarData(dataTexto) {
  return String(dataTexto || '')
    .replace(/NOVA|Novo/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\buma?\b/g, '1')
    .replace(/\s+/g, ' ')
    .trim()
}

function instanteDeDiasAtras(dias, agora) {
  return new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000)
}

function dentroDaJanela(dataTexto, inicio, agora = new Date()) {
  const texto = normalizarData(dataTexto)
  if (!texto) return false

  if (/(minutos?|horas?|segundos?|agora|hoje|minutes?|hours?|just now)/.test(texto)) return true
  if (/(ontem|yesterday)/.test(texto)) return instanteDeDiasAtras(1, agora) >= inicio

  if (/semanas?|weeks?|mes|month|anos?|years?/.test(texto)) return false

  const dia = texto.match(/(\d+)\s*dias?/)
  if (dia) return instanteDeDiasAtras(Number(dia[1]), agora) >= inicio

  return false
}

module.exports = {
  inicioJanelaAvaliacoes,
  inicioDoDiaBrasilia,
  formatarDataHora,
  dentroDaJanela,
}
