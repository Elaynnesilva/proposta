/**
 * Conteúdo padrão da apresentação, baseado no modelo atual em PDF.
 * "shared": textos usados nos 3 tipos de projeto (editar aqui reflete em todos).
 * "images": banco de imagens POR TIPOLOGIA — trocar aqui só afeta aquele tipo.
 *
 * Tudo isso fica salvo em Configurações > Conteúdo do modelo, e cada nova
 * proposta nasce puxando esses valores (podendo divergir depois, se quiser).
 */

export const TIPOLOGIAS = [
  { id: 'residencial', label: 'Residencial' },
  { id: 'comercial', label: 'Comercial' },
  { id: 'corporativo', label: 'Corporativo' },
]

const ph = (seed, w = 1200, h = 800) => `https://picsum.photos/seed/${seed}/${w}/${h}`

export const DEFAULT_IMAGES = {
  residencial: {
    hero: ph('res-hero'),
    intro: ph('res-intro'),
    scope: ph('res-scope'),
    reasons: ph('res-reasons'),
    modeling: ph('res-modeling-1'),
    modeling2: ph('res-modeling-2'),
  },
  comercial: {
    hero: ph('com-hero'),
    intro: ph('com-intro'),
    scope: ph('com-scope'),
    reasons: ph('com-reasons'),
    modeling: ph('com-modeling-1'),
    modeling2: ph('com-modeling-2'),
  },
  corporativo: {
    hero: ph('corp-hero'),
    intro: ph('corp-intro'),
    scope: ph('corp-scope'),
    reasons: ph('corp-reasons'),
    modeling: ph('corp-modeling-1'),
    modeling2: ph('corp-modeling-2'),
  },
}

export const DEFAULT_SHARED_TEXT = {
  agendaTitle: 'O que será apresentado?',
  agenda: [
    'Quem é a sua arquiteta',
    'Do que se trata essa proposta',
    'O que é um projeto',
    'Como funciona o meu método de trabalho',
    'Jornada do cliente durante o projeto',
    'Investimento no seu sonho',
  ],
  aboutTitle: 'Elaynne Oliveira',
  aboutBody:
    'Designer de Interiores há 8 anos e Arquiteta e Urbanista há 3 anos.\n\nAtuo com projetos principalmente nas cidades de Timon-MA e Teresina-PI.\n\nMinha missão é transformar sonhos em realidade, criando espaços que proporcionem bem-estar, funcionalidade e beleza. Cada projeto é pensado de forma personalizada e prática, para que você compreenda facilmente e consiga executar sem complicações.',
  aboutRegistration: 'N° de registro CAU: A279269-9',
  reasonsTitle: 'Por que um projeto faz toda a diferença',
  reasons: [
    {
      title: 'Não saber por onde começar',
      body: 'Sem o projeto não é possível prever o posicionamento das paredes, o layout dos móveis, o design e o volume arquitetônico, nem onde é permitido demolir sem gerar danos e acidentes.',
    },
    {
      title: 'Escolhas aleatórias',
      body: 'Acesso a muitas referências diferentes sem estudo estrutural, de circulação e conforto — e sem estudo financeiro para a obra caber no orçamento pretendido.',
    },
    {
      title: 'Quantidade incerta de materiais',
      body: 'Sem um projeto autoexplicativo, há prejuízo na compra de materiais e mão de obra, e não é possível montar um orçamento preliminar com a quantidade exata do que será necessário.',
    },
    {
      title: 'Prazo indefinido',
      body: 'Sem o projeto não é possível prever o prazo de execução — e obra sem prazo tem custo prolongado, podendo parar no meio por falta de dinheiro.',
    },
    {
      title: 'Resultado diferente do esperado',
      body: 'Obra sem planejamento, organização e direcionamento de um projeto executivo é igual a obra sem fim, com perda de tempo, de dinheiro e frustração.',
    },
  ],
  scopeTitle: 'O que é preciso ser projetado para que o seu sonho seja realizado?',
  scopeSubtitle: 'Conheça todas as partes essenciais do projeto',
  journeySubtitle: 'Do primeiro contato até a chave na mão',
  journey: [
    'Levantamento de medidas',
    'Briefing e estudo do programa de necessidades',
    'Processo criativo e primeiras ideias a partir do levantamento feito, com plantas iniciais e imagens gráficas',
    '1ª apresentação — Projeto de estudo preliminar',
    'Primeiras modificações (se houver)',
    'Desenvolvimento do projeto gráfico, plantas técnicas e modelagem mais realista',
    '2ª apresentação — Projeto gráfico',
    'Últimas modificações (se houver)',
    'Finalização do projeto gráfico e técnico, caderno executivo, descritivo e complementos',
    '3ª apresentação — Entrega final do projeto',
    'Mãos à obra! Acompanhamento da obra',
  ],
  stagesTitle: 'Apresentações de projeto',
  stages: [
    {
      title: 'Estudo preliminar',
      items: ['Ideias iniciais do projeto', 'Plantas e modelagem simples', 'Imagens semi-realistas', 'Alterações necessárias'],
    },
    {
      title: 'Projeto gráfico',
      items: ['Plantas humanizadas', 'Imagens com qualidade realista', 'Alterações necessárias'],
    },
    {
      title: 'Entrega final',
      items: ['Apresentação final com vídeo 3D realista de todo o projeto', 'Entrega dos cadernos executivos, descritivos e complementares', 'Impressão e envio em PDF'],
    },
  ],
  observations:
    'Só poderão ser feitas mudanças no projeto durante o período de criação do estudo preliminar e do projeto gráfico. A partir do início do projeto executivo, novas solicitações de mudanças serão cobradas como excedente, horas a mais de trabalho.',
  feedbacksTitle: "Feedback's de clientes",
  feedbacks: [
    { name: '@oliveira.waldo', photoUrl: 'https://picsum.photos/seed/fb1/200/200', text: 'Optamos pela Elaynne desde a apresentação da proposta, já conseguiu nos surpreender com a organização, riqueza de detalhes e clareza. Projeto de bastante conteúdo. Parabéns!' },
    { name: '@isabelefrazaonutri', photoUrl: 'https://picsum.photos/seed/fb2/200/200', text: 'Amamos! Obrigada por cuidar com tanto carinho do nosso sonho!' },
    { name: '@leticia.kethely', photoUrl: 'https://picsum.photos/seed/fb3/200/200', text: 'Eu amei muito, está todo mundo aqui elogiando teu trabalho, lindaaaa.' },
  ],
  calcTitle: 'Como o valor é calculado',
  calcConsiderations: [
    'Localização do imóvel',
    'Tipologia do projeto',
    'Grau de dificuldade do projeto',
    'Urgência para a execução',
    'Quantidade de ambientes/pavimentos',
    'Necessidades estruturais do projeto',
    'Duração do desenvolvimento do projeto',
    'Duração média do acompanhamento da obra',
    'Custo da impressão do projeto',
    'Custo do RRT (Registro de Responsabilidade Técnica)',
    'Custos da empresa e hora trabalhada',
  ],
  closingQuote: 'É justo que muito custe o que muito vale',
  closingAuthor: 'Santa Teresa D\'ávila',
  closingHeadline: 'Invista nos seus sonhos!',
}
