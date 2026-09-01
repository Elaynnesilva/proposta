/**
 * Lista de campos baseada exatamente na planilha atual da Elaynne (3 pacotes:
 * Completo, Básico, Essencial — cada um com seu próprio prazo, datas e formas
 * de pagamento). Os rótulos abaixo são iguais aos da planilha para a colagem
 * funcionar direto, sem precisar traduzir nada.
 */
const PACKAGES = [
  { id: 'completo', label: 'Completo' },
  { id: 'basico', label: 'Básico' },
  { id: 'essencial', label: 'Essencial' },
]

function packageFieldGroups() {
  const groups = []
  PACKAGES.forEach((p) => {
    groups.push({
      group: `Pacote ${p.label}`,
      fields: [
        [`pacote${cap(p.id)}Valor`, `Pacote ${p.label}`, ''],
        [`${p.id}TotalHoras`, `${p.label} - Total de Horas`, ''],
        [`${p.id}PrazoMeses`, `${p.label} - Prazo do projeto (mês(es))`, ''],
        [`${p.id}Inicio`, `${p.label} - Início do Projeto`, ''],
        [`${p.id}Fim`, `${p.label} - Fim do Projeto`, ''],
        [`${p.id}Apresentacao1`, `${p.label} - 1° apresentação`, ''],
        [`${p.id}Apresentacao2`, `${p.label} - 2° apresentação`, ''],
        [`${p.id}Apresentacao3`, `${p.label} - 3° apresentação final`, ''],
      ],
    })
  })
  PACKAGES.forEach((p) => {
    groups.push({
      group: `Pagamento — Pacote ${p.label}`,
      fields: [
        [`pacote${cap(p.id)}Valor`, `Valor do Pacote ${p.label}`, ''],
        [`${p.id}PagamentoAVista`, `${p.label} - Pagamento à vista`, ''],
        [`${p.id}PagamentoPorMes`, `${p.label} - Pagamento por mês projetual`, ''],
        [`${p.id}PagamentoMetade`, `${p.label} - Pagamento Metade/Metade`, ''],
        [`${p.id}CartaoTotal`, `${p.label} - Cartão de Crédito - Total (juros)`, ''],
        [`${p.id}CartaoParcela12x`, `${p.label} - Cartão de Crédito - Parcela 12x`, ''],
      ],
    })
  })
  return groups
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

export const PACKAGE_LIST = PACKAGES

export const FIELD_GROUPS = [
  {
    group: 'Informações gerais',
    fields: [
      ['tipologiaProjeto', 'Tipologia do projeto', ''],
      ['nomeCliente', 'Nome do cliente', ''],
      ['descricaoProjeto', 'Descrição do projeto', ''],
      ['enderecoImovel', 'Endereço do imóvel', ''],
      ['quantAmbientes', 'Quantidade de ambientes', ''],
      ['ambientesMaiorDificuldade', 'Ambientes (maior dificuldade)', ''],
      ['ambientesMenorDificuldade', 'Ambientes (menor dificuldade)', ''],
    ],
  },
  {
    group: 'Valores base',
    fields: [
      ['valorHoraTecnica', 'Valor Hora Técnica', ''],
      ['valorDiaria', 'Valor da Diária', ''],
      ['rrtProjeto', 'RRT Projeto', ''],
      ['rrtObra', 'RRT Obra', ''],
      ['impressaoProjeto', 'Impressão do projeto', ''],
    ],
  },
  ...packageFieldGroups(),
  {
    group: 'Formas de pagamento (gerais)',
    fields: [
      ['descontoAVista', 'Desconto à vista', ''],
      ['pagamentoCartaoMeses', 'Pagamento Cartão - Mêses', ''],
      ['pagamentoCartaoJuros', 'Pagamento Cartão - Juros', ''],
    ],
  },
  {
    group: 'Descrição do projeto — Etapas principais (uma linha por item)',
    fields: [['etapasPrincipais', 'Etapas principais', '', true]],
  },
  {
    group: 'Escopo — Plantas gerais (uma linha por item)',
    fields: [['plantasGerais', 'Plantas Gerais', '', true]],
  },
  {
    group: 'Escopo — Plantas principais (uma linha por item)',
    fields: [['plantasPrincipais', 'Plantas Principais', '', true]],
  },
  {
    group: 'Escopo — Plantas complementares (uma linha por item)',
    fields: [['pantasComplementares', 'Pantas Complementares', '', true]],
  },
  {
    group: 'Escopo — Vistas 2D (uma linha por item)',
    fields: [['vistas2D', 'Vistas 2D', '', true]],
  },
  {
    group: 'Escopo — Detalhes (uma linha por item)',
    fields: [['detalhes', 'Detalhes', '', true]],
  },
  {
    group: 'Escopo — Interiores (uma linha por item)',
    fields: [['interiores', 'Interiores', '', true]],
  },
  {
    group: 'Escopo — Outros (uma linha por item)',
    fields: [['outros', 'Outros', '', true]],
  },
  {
    group: 'Acompanhamento de obra',
    fields: [
      ['acompanhamentoObraMeses', 'Acompanhamento de obra (mêses)', ''],
      ['acompanhamentoObraDias', 'Acompanhamento de obra (dias por mês)', ''],
      ['acompanhamentoObraDescricao', 'Descrição do serviço de acompanhamento', ''],
    ],
  },
]

export const ALL_FIELD_CODES = [...new Set(FIELD_GROUPS.flatMap((g) => g.fields.map(([code]) => code)))]
export const FIELD_LABELS = Object.fromEntries(FIELD_GROUPS.flatMap((g) => g.fields.map(([code, label]) => [code, label])))

/** minúsculo e sem acento — assim "mêses" e "meses" (ou qualquer variação de acentuação) casam com o mesmo campo */
export function normalizeLabel(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

// mesma variável pode ter mais de um rótulo na planilha (ex: "Pacote Completo" e "Valor do
// Pacote Completo" são o mesmo valor) — este mapa reconhece TODOS os rótulos possíveis,
// já normalizados (sem acento), para colar continuar funcionando mesmo se a pessoa
// corrigir/alterar acentuação do cabeçalho na própria planilha.
export const LABEL_TO_CODE = Object.fromEntries(
  FIELD_GROUPS.flatMap((g) => g.fields.map(([code, label]) => [normalizeLabel(label), code]))
)
export const LIST_FIELD_CODES = new Set(
  FIELD_GROUPS.flatMap((g) => g.fields.filter(([, , , isList]) => isList).map(([code]) => code))
)

export function defaultFieldsObject() {
  const obj = {}
  FIELD_GROUPS.forEach((g) => g.fields.forEach(([code, , def]) => { if (!(code in obj)) obj[code] = def }))
  return obj
}

/** Quebra um campo-lista (várias linhas) em itens, removendo vazios e "0" (placeholder de linha não usada na planilha) */
export function listItems(value) {
  if (!value) return []
  return String(value)
    .split('\n')
    .map((v) => v.trim())
    .filter((v) => v && hasValue(v))
}

/** Verdadeiro se o valor está vazio, é "0" ou é um valor monetário zerado (ex: "R$0,00") */
export function hasValue(v) {
  if (v === undefined || v === null) return false
  const s = String(v).trim()
  if (!s) return false
  if (s === '0') return false
  const cleaned = s.replace(/R\$/gi, '').replace(/%/g, '').replace(/\./g, '').replace(',', '.').trim()
  const n = parseFloat(cleaned)
  if (!isNaN(n) && n === 0) return false
  return true
}

/**
 * Converte um prazo decimal em meses (ex: 1,62) para texto aproximado em
 * meses e dias (ex: "1 mês e 19 dias"), somando ainda uma margem de erro
 * em dias (padrão 2) mostrada só como nota — nunca usada no cálculo principal.
 * Uso: informativo para a própria arquiteta no editor, não aparece na apresentação.
 */
export function mesesParaTexto(valor, toleranciaDias = 2) {
  if (!hasValue(valor)) return ''
  const n = parseFloat(String(valor).replace(',', '.'))
  if (isNaN(n)) return ''
  const meses = Math.floor(n)
  const dias = Math.round((n - meses) * 30)
  const partes = []
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`)
  if (dias > 0) partes.push(`${dias} dias`)
  const base = partes.length ? partes.join(' e ') : '0 dias'
  return `≈ ${base} (+ ${toleranciaDias} dias de tolerância)`
}

/** Converte um link comum do YouTube/Vimeo (compartilhamento, watch, youtu.be) para o formato
 *  de incorporação (/embed/), que é o único que funciona dentro de um iframe. Também reduz a
 *  marca do YouTube (sem precisar de login: sempre aparece o nome do canal, isso o YouTube não deixa tirar). */
export function toEmbedUrl(url) {
  const u = (url || '').trim()
  if (!u) return u
  const params = 'modestbranding=1&rel=0&iv_load_policy=3&color=white'
  let m = u.match(/youtu\.be\/([\w-]+)/)
  if (m) return `https://www.youtube.com/embed/${m[1]}?${params}`
  m = u.match(/youtube\.com\/watch\?v=([\w-]+)/)
  if (m) return `https://www.youtube.com/embed/${m[1]}?${params}`
  m = u.match(/youtube\.com\/shorts\/([\w-]+)/)
  if (m) return `https://www.youtube.com/embed/${m[1]}?${params}`
  m = u.match(/youtube\.com\/embed\/([\w-]+)/)
  if (m && !u.includes('?')) return `https://www.youtube.com/embed/${m[1]}?${params}`
  m = u.match(/vimeo\.com\/(\d+)/)
  if (m) return `https://player.vimeo.com/video/${m[1]}?title=0&byline=0&portrait=0`
  return u
}

/**
 * Mesma conversão de mesesParaTexto, mas para uso na APRESENTAÇÃO (texto limpo, sem
 * anotações internas): a margem de tolerância já vai somada dentro dos dias, sem aparecer
 * como nota separada. Ex: 1,62 -> "1 mês e 21 dias" (19 dias base + 2 de tolerância).
 */
export function mesesParaTextoApresentacao(valor, toleranciaDias = 2) {
  if (!hasValue(valor)) return ''
  const n = parseFloat(String(valor).replace(',', '.'))
  if (isNaN(n)) return ''
  const meses = Math.floor(n)
  const dias = Math.round((n - meses) * 30) + toleranciaDias
  const partes = []
  if (meses > 0) partes.push(`${meses} ${meses === 1 ? 'mês' : 'meses'}`)
  if (dias > 0) partes.push(`${dias} dias`)
  return partes.length ? partes.join(' e ') : '0 dias'
}

/** Extrai um número puro de um valor em formato de dinheiro BR ("R$ 3.325,87" -> 3325.87) */
export function parseMoneyBR(v) {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace('R$', '').replace(/\./g, '').replace(',', '.').trim())
  return isNaN(n) ? null : n
}

/**
 * Arredonda o prazo em meses para a quantidade de PARCELAS do pagamento "por prazo de
 * projeto": frações de até 0,15 (about ~4-5 dias) arredondam para baixo; acima disso,
 * para cima. Ex: 1,62 -> 2 parcelas; 1,10 -> 1 parcela.
 */
export function arredondarParcelas(valor) {
  if (!hasValue(valor)) return null
  const n = parseFloat(String(valor).replace(',', '.'))
  if (isNaN(n)) return null
  const inteiro = Math.floor(n)
  const fracao = n - inteiro
  return fracao <= 0.15 ? Math.max(1, inteiro) : inteiro + 1
}

/** Formata número como moeda BRL quando fizer sentido */
export function money(v) {
  if (v === undefined || v === null || v === '') return ''
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace('R$', '').replace(/\./g, '').replace(',', '.').trim())
  if (isNaN(n)) return v
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
