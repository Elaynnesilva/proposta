import { listItems, money, hasValue, PACKAGE_LIST, mesesParaTextoApresentacao, arredondarParcelas, parseMoneyBR } from './fields'

const SECTION_META = {
  plantasGerais: { label: 'Plantas Gerais', icon: 'blueprint' },
  plantasPrincipais: { label: 'Plantas Principais', icon: 'plan' },
  pantasComplementares: { label: 'Plantas Complementares', icon: 'layers' },
  vistas2D: { label: 'Vistas 2D', icon: 'eye' },
  detalhes: { label: 'Detalhes', icon: 'detail' },
  interiores: { label: 'Design de Interiores', icon: 'sofa' },
  outros: { label: 'Outros', icon: 'more' },
}

/**
 * Monta a lista de slides de uma proposta. Cada slide tem "items": os blocos
 * que aparecem um a um quando a pessoa clica na tela (animação de revelar).
 *
 * A ORDEM e a ESTRUTURA seguem a tabela de dados: primeiro os dados gerais,
 * depois o motivo de contratar um projeto, o escopo (uma página por seção
 * preenchida), a jornada do cliente, e por fim os 3 pacotes na ordem
 * Completo → Básico → Essencial, cada um com suas formas de pagamento.
 */
export function buildSlides({ fields, content, images, settings, custom = [], videoUrl = '', videoEmbedUrl = '', visibility = {} }) {
  const f = (code) => fields[code] || ''
  const list = []
  const vis = {
    packages: { completo: true, basico: true, essencial: true },
    // formas de pagamento agora são por pacote (ocultar no Completo não afeta o Básico/Essencial);
    // "payments" (sem pacote) fica como fallback para propostas salvas antes dessa mudança
    payments: { cartao: true, prazo: true, avista: true, metade: true },
    paymentsByPackage: {},
    ...visibility,
  }
  const paymentsFor = (pkgId) => ({ ...vis.payments, ...(vis.paymentsByPackage?.[pkgId] || {}) })

  list.push({
    id: 'cover',
    type: 'cover',
    image: images.hero,
    kicker: 'APRESENTAÇÃO DE PROPOSTA DE PROJETO',
    title: f('nomeCliente') ? `Projeto — ${f('nomeCliente')}` : 'Projeto de Arquitetura',
    items: [
      f('objetivoProjeto'),
      `Cliente: ${f('nomeCliente') || '—'}${f('tipologiaProjeto') ? ` · ${f('tipologiaProjeto')}` : ''}`,
    ].filter(Boolean),
  })

  list.push({ id: 'agenda', type: 'agenda', image: images.intro, title: content.agendaTitle, items: content.agenda })

  list.push({
    id: 'about',
    type: 'profile',
    image: settings.logoDataUrl ? null : images.intro,
    title: settings.professionalName || content.aboutTitle,
    // usa sempre o texto completo do modelo (que já inclui a missão) — antes, uma bio curta em
    // Configurações podia sobrescrever e "engolir" o parágrafo da missão sem a pessoa perceber
    items: [content.aboutBody, settings.registration || content.aboutRegistration].filter(Boolean),
  })

  list.push({ id: 'div-1', type: 'divider', title: 'Do que se trata esta proposta' })

  const ambientesMaior = (f('ambientesMaiorDificuldade') || '').split(/[,;]\s*/).filter(Boolean)
  const ambientesMenor = (f('ambientesMenorDificuldade') || '').split(/[,;]\s*/).filter(Boolean)

  list.push({
    id: 'client-request',
    type: 'clientRequest',
    image: images.scope,
    title: 'Solicitação do cliente',
    objetivoProjeto: f('objetivoProjeto'),
    rows: [
      ['CLIENTE', f('nomeCliente')],
      ['ENDEREÇO', f('enderecoImovel')],
      ['TIPOLOGIA DO PROJETO', f('tipologiaProjeto')],
      ['OBJETIVO DO PROJETO', f('objetivoProjeto')],
    ].filter(([, v]) => v),
    ambientes: [...ambientesMaior, ...ambientesMenor],
    quantAmbientes: f('quantAmbientes'),
  })

  list.push({ id: 'div-2', type: 'divider', title: 'O que é um projeto?' })
  list.push({ id: 'reasons', type: 'reasons', image: images.reasons, title: content.reasonsTitle, items: content.reasons })
  list.push({ id: 'div-3', type: 'divider', title: 'O que é preciso ser projetado para que o seu sonho seja realizado?', subtitle: content.scopeSubtitle })

  // uma página por seção do escopo — só entra se tiver conteúdo de verdade
  Object.entries(SECTION_META).forEach(([code, meta]) => {
    const items = listItems(f(code))
    if (items.length === 0) return
    list.push({ id: `scope-${code}`, type: 'scopeSection', title: meta.label, image: images.scope, images: [], imageLayout: 'row', items })
  })

  list.push({
    id: 'modeling',
    type: 'modeling',
    image: images.modeling,
    image2: images.modeling2,
    images: [],
    imageLayout: 'row',
    title: 'Modelagem 3D',
    items: ['Imagens e vídeos realistas', 'Vistas internas e externas', 'Imagens de todos os ângulos'],
  })

  if (hasValue(f('acompanhamentoObraMeses')) || hasValue(f('acompanhamentoObraDias'))) {
    list.push({
      id: 'obra', type: 'scopeSection', title: 'Acompanhamento de obra', image: images.scope, images: [], imageLayout: 'row',
      description: f('acompanhamentoObraDescricao'),
      items: [
        hasValue(f('acompanhamentoObraMeses')) && `${f('acompanhamentoObraMeses')} meses de acompanhamento`,
        hasValue(f('acompanhamentoObraDias')) && `${f('acompanhamentoObraDias')} dias de visita por mês`,
      ].filter(Boolean),
    })
  }

  const etapas = listItems(f('etapasPrincipais'))
  list.push({ id: 'journey', type: 'journeyFlow', title: 'Jornada do cliente', subtitle: content.journeySubtitle, items: etapas.length ? etapas : content.journey, stepImages: [] })

  list.push({
    id: 'stages',
    type: 'stages',
    title: content.stagesTitle,
    stages: content.stages,
    footnote: content.observations,
  })

  if (content.feedbacks?.length) {
    list.push({ id: 'feedbacks', type: 'feedbacks', title: content.feedbacksTitle, items: content.feedbacks })
  }

  list.push({ id: 'div-4', type: 'divider', title: 'Qual será o prazo do projeto e o investimento no seu sonho?' })

  const calcExtras = [
    hasValue(f('rrtProjeto')) && `RRT de projeto: ${money(f('rrtProjeto'))}`,
    hasValue(f('rrtObra')) && `RRT de obra: ${money(f('rrtObra'))}`,
    hasValue(f('impressaoProjeto')) && `Impressão do projeto: ${money(f('impressaoProjeto'))}`,
  ].filter(Boolean)

  if (calcExtras.length || hasValue(f('valorHoraTecnica')) || hasValue(f('valorDiaria'))) {
    list.push({
      id: 'calc', type: 'pricingCalc', title: content.calcTitle,
      items: [...content.calcConsiderations, ...calcExtras],
      hourValue: hasValue(f('valorHoraTecnica')) ? `${money(f('valorHoraTecnica'))} / hora` : '',
      dayValue: hasValue(f('valorDiaria')) ? `${money(f('valorDiaria'))} / dia` : '',
    })
  }

  // um slide por pacote, sempre nesta ordem: Completo -> Básico -> Essencial
  const packageSummaries = []
  PACKAGE_LIST.forEach((pkg) => {
    if (!vis.packages[pkg.id]) return
    const value = f(`pacote${cap(pkg.id)}Valor`)
    if (!hasValue(value)) return

    const schedule = [
      hasValue(f(`${pkg.id}TotalHoras`)) && `${f(`${pkg.id}TotalHoras`)}h de trabalho`,
      hasValue(f(`${pkg.id}PrazoMeses`)) && `${mesesParaTextoApresentacao(f(`${pkg.id}PrazoMeses`))} de prazo`,
      f(`${pkg.id}Inicio`) && f(`${pkg.id}Fim`) && `De ${f(`${pkg.id}Inicio`)} até ${f(`${pkg.id}Fim`)}`,
    ].filter(Boolean)

    const payments = paymentsFor(pkg.id)
    const parcelasPrazo = arredondarParcelas(f(`${pkg.id}PrazoMeses`))
    const valorNumerico = parseMoneyBR(value)
    const paymentCards = [
      payments.cartao && hasValue(f(`${pkg.id}CartaoParcela12x`)) && {
        id: 'cartao', label: 'Cartão de crédito', highlight: true,
        value: `${f('pagamentoCartaoMeses') || '12'}x de ${money(f(`${pkg.id}CartaoParcela12x`))}`,
        detail: hasValue(f(`${pkg.id}CartaoTotal`)) ? `Total com juros: ${money(f(`${pkg.id}CartaoTotal`))}${f('pagamentoCartaoJuros') ? ` (${f('pagamentoCartaoJuros')} a.a.)` : ''}` : '',
      },
      payments.prazo && parcelasPrazo && valorNumerico != null && {
        id: 'prazo', label: 'Por prazo de projeto',
        // o valor da parcela é o valor total do pacote dividido pelo nº de parcelas já
        // arredondado — não pela fração decimal do prazo (ex: 3325,87 ÷ 2, não ÷ 1,62)
        value: `${parcelasPrazo}x de ${money(valorNumerico / parcelasPrazo)}`,
        detail: 'Uma parcela por mês de desenvolvimento do projeto',
      },
      payments.avista && hasValue(f(`${pkg.id}PagamentoAVista`)) && {
        id: 'avista', label: 'À vista',
        value: money(f(`${pkg.id}PagamentoAVista`)),
        detail: f('descontoAVista') ? `${f('descontoAVista')} de desconto` : '',
      },
      payments.metade && hasValue(f(`${pkg.id}PagamentoMetade`)) && {
        id: 'metade', label: 'Metade / Metade',
        value: `2x de ${money(f(`${pkg.id}PagamentoMetade`))}`,
        detail: '50% no início, 50% na entrega',
      },
    ].filter(Boolean)

    list.push({
      id: `package-${pkg.id}`,
      type: 'packagePricing',
      packageId: pkg.id,
      title: `Pacote ${pkg.label}`,
      value: money(value),
      schedule,
      paymentCards,
      benefits: listItems(f(`beneficios${cap(pkg.id)}`)),
    })

    packageSummaries.push({ id: pkg.id, label: pkg.label, value: money(value), schedule, paymentCards, benefits: listItems(f(`beneficios${cap(pkg.id)}`)) })
  })

  if (packageSummaries.length > 1) {
    list.push({ id: 'packages-summary', type: 'packagesSummary', title: 'Resumo dos pacotes', packages: packageSummaries })
  }

  list.push({ id: 'video', type: 'video', title: 'Vídeo do projeto', videoUrl, embedUrl: videoEmbedUrl })

  custom.forEach((c, i) => list.push({ ...c, id: c.id || `custom-${i}`, type: 'custom' }))

  list.push({ id: 'closing', type: 'closing', headline: content.closingHeadline, quote: content.closingQuote, author: content.closingAuthor })

  return list
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1) }
