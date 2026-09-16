import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts'
import { listProposals, saveProposal, deleteProposal, getSettings, closeProposal } from '../lib/db'
import EncerrarProposta from '../components/EncerrarProposta'
import AvisoTeste from '../components/AvisoTeste'
import { defaultFieldsObject } from '../lib/fields'
import { DEFAULT_PALETTE } from '../lib/templates'

const STATUS = {
  rascunho: { label: 'Rascunho', color: '#9AA0A6', bg: '#F1F1EF' },
  enviada: { label: 'Enviada', color: '#2563EB', bg: '#EFF4FE' },
  aceita: { label: 'Aceita', color: '#16803C', bg: '#EAF7EE' },
  recusada: { label: 'Recusada', color: '#B42318', bg: '#FDEEEC' },
}

export default function Dashboard({ acesso }) {
  const [proposals, setProposals] = useState([])
  const [loading, setLoading] = useState(true)
  const [renamingId, setRenamingId] = useState(null)
  const [valueModalId, setValueModalId] = useState(null)
  const [encerrarId, setEncerrarId] = useState(null)
  const [avisoLimite, setAvisoLimite] = useState(false)
  const [settings, setSettings] = useState(null)
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterTipologia, setFilterTipologia] = useState('todas')
  const [filterStatus, setFilterStatus] = useState('todas')
  const navigate = useNavigate()

  useEffect(() => { refresh(); getSettings().then(setSettings) }, [])

  /**
   * Passados {DIAS_ATE_ENCERRAR} dias da entrega, a proposta aceita entra em PENDENTE DE
   * ENCERRAMENTO: a edição trava, mas nada é apagado.
   *
   * A primeira ideia era encerrar de vez, sozinho. O problema é que encerrar apaga a
   * apresentação e as fotos, e aqui não há ninguém na frente da tela para baixar o PDF antes —
   * quem ficasse dois meses sem entrar voltaria e encontraria tudo apagado, sem cópia. Travar
   * a edição empurra a pessoa a resolver (baixar o PDF e confirmar) sem risco de perda.
   *
   * Em troca, o espaço só é devolvido quando alguém confirma. É uma escolha consciente:
   * perder trabalho é pior do que ocupar memória por mais alguns dias.
   */
  async function marcarPendentes(lista) {
    const vencidas = lista.filter((p) => (
      !p.closed && !p.pendenteEncerramento && p.status === 'aceita' && (diasAteEncerrar(p) ?? 1) <= 0
    ))
    if (!vencidas.length) return lista
    for (const p of vencidas) {
      await saveProposal({ ...p, pendenteEncerramento: true }).catch((err) => console.error(err))
    }
    return listProposals()
  }

  async function refresh() {
    setLoading(true)
    const todas = await listProposals()
    const agora = Date.now()
    const intocadas = todas.filter(isUntouchedDraft)

    // apaga de vez as que já passaram do prazo de carência (as recém-criadas ficam de fora
    // da lista, mas só são apagadas na próxima visita — ver comentário em DRAFT_GRACE_MS)
    const paraApagar = intocadas.filter((p) => agora - toMillis(p.updatedAt) > DRAFT_GRACE_MS)
    if (paraApagar.length) {
      await Promise.all(paraApagar.map((p) => deleteProposal(p.id).catch((err) => console.error(err))))
    }

    const apos = await marcarPendentes(todas)
    // as intocadas somem da lista e das contas do gráfico imediatamente, apagadas ou não
    setProposals(apos.filter((p) => !isUntouchedDraft(p)))
    setLoading(false)
  }

  /**
   * Quantas propostas foram criadas no mês corrente. O limite existe para o banco não crescer
   * mais rápido do que o espaço disponível — o plano gratuito do Firebase dá 1 GiB para a
   * conta inteira, e cada proposta com fotos pesa alguns MB.
   */
  const criadasNoMes = useMemo(() => {
    const agora = new Date()
    return proposals.filter((p) => {
      const d = p.createdAt?.toDate ? p.createdAt.toDate() : (p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000) : null)
      if (!d) return false
      return d.getFullYear() === agora.getFullYear() && d.getMonth() === agora.getMonth()
    }).length
  }, [proposals])

  // quem está em teste tem um limite próprio, menor: é o período em que a pessoa ainda não
  // pagou nada e, se não converter, o que ela criar fica ocupando espaço para sempre
  const ehTeste = acesso?.papel === 'teste'
  const limiteMensal = ehTeste
    ? (Number(acesso?.config?.suporte?.limiteMensalTeste) || 2)
    : (Number(acesso?.config?.suporte?.limiteMensal) || 6)
  // a administradora não entra no limite: é ela quem demonstra o sistema e acompanha o consumo
  const limiteAtingido = acesso?.papel !== 'dono' && criadasNoMes >= limiteMensal
  const motivoBloqueio = !limiteAtingido ? '' : (ehTeste
    ? 'Você excedeu o limite de criação de propostas na versão de teste, garanta agora o seu Pack PreciFiqueBem'
    : 'Você excedeu o limite mensal de criação de propostas, exclua uma proposta para liberar o botão ou aguarde o seu limite ser reestabelecido no próximo mês')

  async function createProposal() {
    // o aviso aparece só aqui, ao tentar criar — fora disso a tela fica limpa
    if (limiteAtingido) { setAvisoLimite(true); return }
    const saved = await saveProposal({
      name: 'Nova proposta',
      status: 'rascunho',
      tipologia: 'residencial',
      template: 'minimalista',
      palette: DEFAULT_PALETTE,
      fields: defaultFieldsObject(),
      customSlides: [],
    })
    navigate(`/proposta/${saved.id}/editar`)
  }

  /**
   * Encerramento da proposta: apaga as fotos e a apresentação, mantendo os dados do projeto.
   * É o que devolve espaço — as fotos são quase todo o peso de uma proposta, e o plano
   * gratuito do Firebase tem 1 GiB no total para a conta inteira.
   */
  async function updateStatus(p, status, acceptedValue) {
    const saved = await saveProposal({ ...p, status, acceptedValue: status === 'aceita' ? acceptedValue : undefined })
    setProposals((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))
    setValueModalId(null)
  }

  async function rename(p, name) {
    const saved = await saveProposal({ ...p, name })
    setProposals((prev) => prev.map((x) => (x.id === saved.id ? saved : x)))
    setRenamingId(null)
  }

  async function remove(id) {
    if (!confirm('Excluir esta proposta permanentemente?')) return
    await deleteProposal(id)
    refresh()
  }

  const totalReceived = useMemo(
    () => proposals.filter((p) => p.status === 'aceita').reduce((sum, p) => sum + (Number(p.acceptedValue) || 0), 0),
    [proposals]
  )

  const chartData = useMemo(() => {
    const aceita = proposals.filter((p) => p.status === 'aceita').length
    const recusada = proposals.filter((p) => p.status === 'recusada').length
    const emAndamento = proposals.length - aceita - recusada
    return [
      { name: 'Aceitas', value: aceita, color: '#16803C' },
      { name: 'Recusadas', value: recusada, color: '#B42318' },
      { name: 'Em andamento', value: emAndamento, color: '#C9C4B6' },
    ].filter((d) => d.value > 0)
  }, [proposals])

  const filteredProposals = useMemo(() => {
    const q = search.trim().toLowerCase()
    const lista = proposals.filter((p) => {
      if (filterTipologia !== 'todas' && p.tipologia !== filterTipologia) return false
      if (filterStatus !== 'todas' && p.status !== filterStatus) return false
      if (q && !(p.name || '').toLowerCase().includes(q) && !(p.fields?.nomeCliente || '').toLowerCase().includes(q)) return false
      return true
    })
    // proposta encerrada ou recusada é assunto fechado: vai para o fim da lista, para as que
    // ainda estão em andamento ficarem à mão
    const arquivada = (p) => (p.closed || p.status === 'recusada' ? 1 : 0)
    return [...lista].sort((a, b) => arquivada(a) - arquivada(b))
  }, [proposals, search, filterTipologia, filterStatus])

  return (
    <div className="p-6 md:p-10 max-w-6xl mx-auto">
      {avisoLimite && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-6" onClick={() => setAvisoLimite(false)}>
          <div className="bg-white rounded-xl p-5 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm text-ink mb-4">{motivoBloqueio}</p>
            {ehTeste && acesso?.config?.suporte?.botaoLink && (
              <a
                href={acesso.config.suporte.botaoLink} target="_blank" rel="noreferrer"
                className="block text-sm font-medium mb-2 px-4 py-2.5 rounded-full bg-clay text-white"
              >{acesso.config.suporte.botaoNome || 'Saiba mais'}</a>
            )}
            <button onClick={() => setAvisoLimite(false)} className="w-full text-sm py-2.5 rounded-lg border border-line text-muted">Fechar</button>
          </div>
        </div>
      )}

      {settings && (settings.logoDataUrl || settings.companyName) && (
        <div className="flex items-center gap-3 mb-6">
          {settings.logoDataUrl && <img src={settings.logoDataUrl} alt="logo" className="w-14 h-14 rounded-full object-cover border border-line" />}
          <div>
            {settings.professionalName && <div className="font-display text-xl text-ink leading-tight">{settings.professionalName}</div>}
            {settings.companyName && <div className="text-sm text-muted leading-tight">{settings.companyName}</div>}
          </div>
        </div>
      )}

      {acesso?.papel === 'teste' && <AvisoTeste acesso={acesso} nome={settings?.professionalName} />}

      <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink">Propostas</h1>
          <p className="text-sm text-muted mt-1">Crie, acompanhe e apresente suas propostas de projeto.</p>
        </div>
        <div className="text-right">
        <button
          onClick={createProposal}
          disabled={acesso && acesso.podeEditar === false}
          className={`text-sm font-medium px-5 py-2.5 rounded-full transition disabled:opacity-40 ${limiteAtingido ? 'bg-clay/40 text-white' : 'bg-clay text-white hover:opacity-90'}`}
        >
          + Nova proposta
        </button>
        {acesso?.papel !== 'dono' && (
          <p className="text-[11px] mt-1.5" style={limiteAtingido ? { color: '#B42318' } : { color: '#7C8288' }}>
            {criadasNoMes} de {limiteMensal} propostas criadas neste mês
          </p>
        )}
        </div>
      </div>

      {/* CRM highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="md:col-span-2 bg-ink text-white rounded-2xl p-6 flex flex-col justify-center">
          <div className="text-xs uppercase tracking-wide text-white/60 mb-2">Total recebido em propostas aceitas</div>
          <div className="font-display text-4xl" style={{ color: '#E0977E' }}>
            {totalReceived.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          </div>
          <div className="text-xs text-white/50 mt-2">{proposals.filter((p) => p.status === 'aceita').length} proposta(s) aceita(s)</div>
        </div>
        <div className="bg-white border border-line rounded-2xl p-4 flex items-center justify-center">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={35} outerRadius={55} paddingAngle={3}>
                  {chartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={24} wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <span className="text-xs text-muted">Sem dados ainda</span>
          )}
        </div>
      </div>

      {/* Busca e filtros */}
      {proposals.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              className={`w-9 h-9 rounded-full border flex items-center justify-center transition ${filtersOpen ? 'bg-ink text-white border-ink' : 'border-line text-ink/70 hover:bg-sand bg-white'}`}
              title="Buscar e filtrar"
            >🔎</button>
            {(search || filterTipologia !== 'todas' || filterStatus !== 'todas') && !filtersOpen && (
              <span className="text-xs text-muted">Filtros ativos — clique na lupa para ajustar</span>
            )}
          </div>
          {filtersOpen && (
            <div className="bg-white border border-line rounded-2xl p-4 mt-2 flex flex-col md:flex-row gap-3 md:items-center">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome da proposta ou do cliente…"
                className="flex-1 text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
              />
              <div className="flex gap-1.5 flex-wrap">
                {[['todas', 'Todas'], ['residencial', 'Residencial'], ['comercial', 'Comercial'], ['corporativo', 'Corporativo']].map(([id, label]) => (
                  <button key={id} onClick={() => setFilterTipologia(id)} className={`text-xs px-3 py-1.5 rounded-full border ${filterTipologia === id ? 'bg-ink text-white border-ink' : 'border-line text-ink/70 hover:bg-sand'}`}>{label}</button>
                ))}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {[['todas', 'Qualquer status'], ['aceita', 'Aceitas'], ['recusada', 'Recusadas']].map(([id, label]) => (
                  <button key={id} onClick={() => setFilterStatus(id)} className={`text-xs px-3 py-1.5 rounded-full border ${filterStatus === id ? 'bg-ink text-white border-ink' : 'border-line text-ink/70 hover:bg-sand'}`}>{label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted">Carregando…</div>
      ) : proposals.length === 0 ? (
        <div className="text-center py-20 text-muted">
          <p className="mb-4">Você ainda não criou nenhuma proposta.</p>
          <button onClick={createProposal} className="text-clay font-medium hover:underline">Criar a primeira proposta →</button>
        </div>
      ) : filteredProposals.length === 0 ? (
        <div className="text-center py-20 text-muted text-sm">Nenhuma proposta encontrada com esses filtros.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProposals.map((p) => (
            <div key={p.id} className="bg-white rounded-2xl p-5 flex flex-col transition" style={p.status === 'aceita' ? { border: '2px solid #16803C', boxShadow: '0 4px 16px rgba(22,128,60,0.12)' } : { border: '1px solid #E4DFD6' }}>
              <div className="flex items-start justify-between gap-2 mb-3">
                {renamingId === p.id ? (
                  <input
                    autoFocus defaultValue={p.name}
                    onBlur={(e) => rename(p, e.target.value || p.name)}
                    onKeyDown={(e) => e.key === 'Enter' && rename(p, e.target.value || p.name)}
                    className="text-sm font-semibold border-b border-clay outline-none w-full"
                  />
                ) : (
                  <h3 className="font-semibold text-ink text-sm leading-snug cursor-pointer" onClick={() => setRenamingId(p.id)} title="Clique para renomear">
                    {p.name || 'Sem nome'}
                  </h3>
                )}
                <span
                  className="shrink-0 text-[10px] uppercase tracking-wide px-2 py-1 rounded-full"
                  style={p.closed && p.status === 'aceita'
                    ? { color: '#5B636B', background: '#EFEDE8' }
                    : { color: STATUS[p.status]?.color, background: STATUS[p.status]?.bg }}
                >
                  {p.closed && p.status === 'aceita' ? 'Projeto Finalizado' : STATUS[p.status]?.label}
                </span>
              </div>

              <div className="text-xs text-muted mb-1">{p.fields?.nomeCliente || 'Cliente não definido'}</div>
              <div className="text-xs text-muted mb-1 capitalize">{p.tipologia}</div>
              <div className="text-[11px] text-muted/80 mb-4">{formatProposalDate(p)}</div>

              {p.status === 'aceita' && p.acceptedValue != null && (
                <div className="text-sm font-semibold mb-3" style={{ color: '#16803C' }}>
                  {Number(p.acceptedValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no caixa
                </div>
              )}

              {/* proposta encerrada é só consulta: fica o acesso aos dados do projeto, sem
                  apresentação e sem edição — a apresentação e as fotos já não existem mais */}
              <div className="flex gap-2 mb-4 flex-wrap">
                <button onClick={() => navigate(`/proposta/${p.id}/editar`)} className="text-xs px-3 py-1.5 rounded-full border border-line hover:bg-sand">
                  {p.closed || p.pendenteEncerramento ? 'Ver dados do projeto' : 'Editar'}
                </button>
                {/* proposta encerrada ou recusada não se apresenta mais: as fotos foram apagadas
                    e o que sobraria na tela seriam as imagens padrão, dando a impressão errada
                    de que a apresentação continua inteira */}
                {!p.closed && p.status !== 'recusada' && (
                  <button onClick={() => navigate(`/proposta/${p.id}/apresentar`)} className="text-xs px-3 py-1.5 rounded-full bg-ink text-white hover:opacity-90">Apresentar</button>
                )}
                <button onClick={() => remove(p.id)} className="text-xs px-3 py-1.5 rounded-full text-red-600 hover:bg-red-50 ml-auto">Excluir</button>
              </div>

              {/* contagem regressiva: avisa com antecedência que a edição vai travar */}
              {!p.closed && !p.pendenteEncerramento && p.status === 'aceita' && (diasAteEncerrar(p) ?? 99) <= 30 && (
                <div
                  className="text-[11px] mb-3 p-2 rounded-lg"
                  style={(diasAteEncerrar(p) ?? 99) <= 7 ? { background: '#FDEEEC', color: '#B42318' } : { background: '#FEF6E7', color: '#8A5A00' }}
                >
                  Em {Math.max(diasAteEncerrar(p), 0)} dia(s), em {prazoDeEncerramento(p)?.toLocaleDateString('pt-BR')},
                  esta proposta trava para edição e fica aguardando encerramento. Nada é apagado até você confirmar.
                </div>
              )}

              {!p.closed && p.pendenteEncerramento && (
                <div className="text-[11px] mb-3 p-2 rounded-lg" style={{ background: '#FDEEEC', color: '#B42318' }}>
                  <strong>Pendente de encerramento.</strong> Passaram {DIAS_ATE_ENCERRAR} dias da entrega e a
                  edição está travada. Suas fotos continuam guardadas — baixe o PDF e encerre para liberar espaço.
                </div>
              )}

              {/* aceita e já passou da data de entrega: hora de encerrar e devolver o espaço */}
              {!p.closed && p.status === 'aceita' && entregaVencida(p) && (
                <button
                  onClick={() => setEncerrarId(p.id)}
                  className="w-full text-xs py-2.5 rounded-lg mb-3 font-medium text-white"
                  style={{ background: p.pendenteEncerramento ? '#B42318' : '#B45309' }}
                >📦 Encerrar proposta e liberar espaço</button>
              )}

              <div className="mt-auto pt-3 border-t border-line flex gap-2">
                <button
                  onClick={() => (valueModalId === p.id ? setValueModalId(null) : setValueModalId(p.id))}
                  className={`flex-1 text-xs py-1.5 rounded-full ${p.status === 'aceita' ? 'bg-[#EAF7EE] text-[#16803C]' : 'border border-line text-ink/70 hover:bg-sand'}`}
                >Aceita</button>
                <button
                  onClick={() => (p.status === 'recusada' || p.closed ? null : setEncerrarId(p.id))}
                  className={`flex-1 text-xs py-1.5 rounded-full ${p.status === 'recusada' ? 'bg-[#FDEEEC] text-[#B42318]' : 'border border-line text-ink/70 hover:bg-sand'}`}
                >Recusada</button>
              </div>

              {valueModalId === p.id && (
                <AcceptValueForm
                  defaultValue={p.acceptedValue}
                  onConfirm={(val) => updateStatus(p, 'aceita', val)}
                />
              )}

              {encerrarId === p.id && (
                <EncerrarProposta
                  proposal={p}
                  recusa={p.status !== 'aceita'}
                  onCancelar={() => setEncerrarId(null)}
                  onPronto={async (apagadas) => {
                    setEncerrarId(null)
                    await refresh()
                    alert(apagadas > 0
                      ? `Proposta encerrada. ${apagadas} foto(s) foram apagadas e o espaço foi liberado.`
                      : 'Proposta encerrada.')
                  }}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Data mostrada no card: apresentação marcada, se houver, senão a data de criação da proposta */
function formatProposalDate(p) {
  if (p.scheduledAt) {
    const d = new Date(p.scheduledAt)
    if (!isNaN(d)) return `Apresentação em ${d.toLocaleDateString('pt-BR')}`
  }
  const created = p.createdAt?.toDate ? p.createdAt.toDate() : (p.createdAt?.seconds ? new Date(p.createdAt.seconds * 1000) : null)
  if (created) return `Criada em ${created.toLocaleDateString('pt-BR')}`
  return ''
}

/** Um rascunho só deve aparecer na lista se a pessoa já começou a preencher alguma coisa */
/**
 * Prazo de carência antes de apagar um rascunho intocado. Serve para o caso de a pessoa ter
 * acabado de criar a proposta e ainda estar preenchendo em outra aba: se apagássemos na hora,
 * o próximo salvamento dela falharia (o documento já não existiria). Dentro desse prazo o
 * rascunho apenas não aparece; passado o prazo, some de vez na próxima abertura do painel.
 */
const DRAFT_GRACE_MS = 10 * 60 * 1000

/**
 * Rascunho que nunca foi tocado: criado pelo botão "+ Nova proposta" e abandonado sem nenhuma
 * alteração. Esses são apagados sozinhos — antes eles ficavam escondidos da lista mas ainda
 * contavam no gráfico como "em andamento", inflando o número sem representar proposta nenhuma.
 * Qualquer sinal de que a pessoa mexeu ali dentro (nome, tipologia, cores, campos, slides,
 * vídeo ou mudança de status) já tira a proposta desta categoria.
 */
function isUntouchedDraft(p) {
  if ((p.status || 'rascunho') !== 'rascunho') return false
  const nome = (p.name || '').trim()
  if (nome && nome !== 'Nova proposta') return false
  if ((p.tipologia || 'residencial') !== 'residencial') return false
  if (p.customSlides?.length || p.slideOrder?.length || p.hiddenSlides?.length) return false
  if (p.slideOverrides && Object.keys(p.slideOverrides).length) return false
  if (p.videoUrl || p.videoEmbedUrl || p.public) return false
  if (p.acceptedValue != null || p.acceptedPackageId) return false
  if (p.palette && DEFAULT_PALETTE.some((hex, i) => p.palette[i] !== hex)) return false
  return !Object.values(p.fields || {}).some((v) => String(v || '').trim() !== '')
}

/** updatedAt pode vir como Timestamp do Firestore, objeto {seconds} ou string — normaliza. */
function toMillis(ts) {
  if (!ts) return 0
  if (typeof ts.toMillis === 'function') return ts.toMillis()
  if (typeof ts.seconds === 'number') return ts.seconds * 1000
  const n = new Date(ts).getTime()
  return Number.isNaN(n) ? 0 : n
}

function AcceptValueForm({ defaultValue, onConfirm }) {
  const [value, setValue] = useState(defaultValue ?? '')
  return (
    <div className="mt-3 flex gap-2">
      <input
        autoFocus type="number" placeholder="Valor que entrou no caixa"
        value={value} onChange={(e) => setValue(e.target.value)}
        className="flex-1 text-sm p-2 rounded-lg border border-line outline-none focus:border-clay"
      />
      <button
        onClick={() => value !== '' && onConfirm(Number(value))}
        className="text-xs px-3 rounded-lg bg-clay text-white"
      >OK</button>
    </div>
  )
}

/**
 * Data de entrega do projeto (o "Fim do Projeto" do pacote contratado, ou o mais distante
 * entre os pacotes). É a partir dela que a proposta aceita passa a oferecer o encerramento —
 * antes disso a apresentação ainda pode ser útil.
 */
/** Dias de tolerância após a entrega antes do encerramento acontecer sozinho. */
export const DIAS_ATE_ENCERRAR = 30

/** Data final de entrega do projeto (a mais distante entre os pacotes). */
function dataDeEntrega(p) {
  const fields = p.fields || {}
  const datas = ['completo', 'basico', 'essencial']
    .map((id) => parseDataBR(fields[`${id}Fim`]))
    .filter(Boolean)
  if (!datas.length) return null
  return new Date(Math.max(...datas.map((d) => d.getTime())))
}

/**
 * Quando esta proposta será encerrada sozinha. Encerrar apaga a apresentação e as fotos —
 * é o que devolve espaço — então proposta aceita e entregue não pode ficar ocupando memória
 * para sempre só porque ninguém se lembrou de encerrar.
 */
export function prazoDeEncerramento(p) {
  const entrega = dataDeEntrega(p)
  if (!entrega) return null
  return new Date(entrega.getTime() + DIAS_ATE_ENCERRAR * 24 * 60 * 60 * 1000)
}

export function diasAteEncerrar(p) {
  const prazo = prazoDeEncerramento(p)
  if (!prazo) return null
  return Math.ceil((prazo.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

function entregaVencida(p) {
  const fields = p.fields || {}
  const datas = ['completo', 'basico', 'essencial']
    .map((id) => parseDataBR(fields[`${id}Fim`]))
    .filter(Boolean)
  if (!datas.length) return false
  const ultima = new Date(Math.max(...datas.map((d) => d.getTime())))
  return ultima.getTime() < Date.now()
}

function parseDataBR(valor) {
  const m = String(valor || '').match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return isNaN(d) ? null : d
}

