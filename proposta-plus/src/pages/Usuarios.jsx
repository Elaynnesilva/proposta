import React, { useEffect, useMemo, useState } from 'react'
import {
  lerConfigAcesso, salvarConfigAcesso, listarAcessos,
  separarEmails, normalizarEmail, SUPORTE_PADRAO, marcarParaZerar, sincronizarVencidos,
} from '../lib/acesso'
import { iniciarMedicaoEspaco, lerMedicaoSalva, medicaoEstaRodando, lerProgressoMedicao } from '../lib/db'

const ABAS = [
  { id: 'autorizados', label: 'Autorizados' },
  { id: 'teste', label: 'Teste' },
  { id: 'excluidos', label: 'Excluídos' },
  { id: 'suporte', label: 'Suporte' },
]

export default function Usuarios() {
  const [config, setConfig] = useState(null)
  const [acessos, setAcessos] = useState([])
  const [aba, setAba] = useState('autorizados')
  const [salvando, setSalvando] = useState(false)

  useEffect(() => { recarregar() }, [])

  async function recarregar() {
    const [c, a] = await Promise.all([lerConfigAcesso(), listarAcessos()])
    setAcessos(a)
    // aproveita a visita para atualizar a lista de testes vencidos que as regras consultam
    const atualizado = await sincronizarVencidos(c, a).catch(() => c)
    setConfig(atualizado)
  }

  async function gravar(patch) {
    setSalvando(true)
    const proximo = { ...config, ...patch }
    setConfig(proximo)
    try {
      await salvarConfigAcesso(proximo)
    } catch (err) {
      console.error(err)
      alert('Não consegui salvar agora. Confira se as regras do Firestore já foram publicadas no Console do Firebase.')
    } finally {
      setSalvando(false)
    }
  }

  /** dados da tabela: o que a própria pessoa registrou, casado com a lista por e-mail */
  const porEmail = useMemo(() => {
    const mapa = new Map()
    acessos.forEach((a) => { if (a.email) mapa.set(normalizarEmail(a.email), a) })
    return mapa
  }, [acessos])

  const colaboradores = useMemo(
    () => new Set((config?.suporte?.colaboradores || []).map(normalizarEmail)),
    [config],
  )

  const emailsAutorizados = useMemo(
    () => new Set((config?.autorizados || []).map((a) => normalizarEmail(a.email))),
    [config],
  )
  const emailsExcluidos = useMemo(
    () => new Set((config?.excluidos || []).map((a) => normalizarEmail(a.email))),
    [config],
  )

  // quem entrou e ainda não está em nenhuma lista está em teste
  const emTeste = useMemo(() => {
    const principal = normalizarEmail(config?.suporte?.emailPrincipal)
    const mapa = new Map()
    // quem já fez login entra pelo próprio cadastro
    acessos.forEach((a) => {
      const e = normalizarEmail(a.email)
      if (!e || e === principal) return
      if (emailsAutorizados.has(e) || emailsExcluidos.has(e)) return
      mapa.set(e, a)
    })
    // e quem foi colocado em teste sem nunca ter entrado (ex: veio dos autorizados)
    ;(config?.teste || []).forEach((t) => {
      const e = normalizarEmail(t.email)
      if (!e || e === principal) return
      if (emailsAutorizados.has(e) || emailsExcluidos.has(e) || mapa.has(e)) return
      mapa.set(e, { email: e, desde: t.desde })
    })
    return [...mapa.values()]
  }, [acessos, emailsAutorizados, emailsExcluidos, config])

  if (!config) return <div className="p-6 text-sm text-muted">Carregando…</div>

  return (
    <div className="max-w-5xl mx-auto px-6 md:px-10 py-8">
      <h1 className="font-display text-3xl text-ink mb-1">Usuários do sistema</h1>
      <p className="text-sm text-muted mb-6">
        Quem pode entrar, quem está em teste e quem foi bloqueado. Cada pessoa continua com o próprio
        espaço — ninguém enxerga as propostas de ninguém.
      </p>

      <div className="flex gap-1 mb-8 border-b border-line overflow-x-auto">
        {ABAS.map((t) => (
          <button
            key={t.id} onClick={() => setAba(t.id)}
            className={`text-sm px-4 py-2.5 whitespace-nowrap border-b-2 -mb-px transition ${aba === t.id ? 'border-clay text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}
          >{t.label}</button>
        ))}
      </div>

      {aba === 'autorizados' && (
        <AbaAutorizados config={config} porEmail={porEmail} colaboradores={colaboradores} onGravar={gravar} />
      )}
      {aba === 'teste' && (
        <AbaTeste emTeste={emTeste} config={config} colaboradores={colaboradores} onGravar={gravar} />
      )}
      {aba === 'excluidos' && (
        <AbaExcluidos config={config} porEmail={porEmail} colaboradores={colaboradores} onGravar={gravar} onRecarregar={recarregar} />
      )}
      {aba === 'suporte' && (
        <>
          <PainelDeEspaco />
          <AbaSuporte config={config} onGravar={gravar} salvando={salvando} />
        </>
      )}
    </div>
  )
}

/* ---------------- Autorizados ---------------- */

function AbaAutorizados({ config, porEmail, colaboradores, onGravar }) {
  const [colagem, setColagem] = useState('')

  function adicionar() {
    const novos = separarEmails(colagem)
    if (!novos.length) return alert('Não encontrei nenhum e-mail no texto colado.')
    const atuais = config.autorizados || []
    const jaTem = new Set(atuais.map((a) => normalizarEmail(a.email)))
    const adicionados = novos.filter((e) => !jaTem.has(e)).map((email) => ({ email, desde: new Date().toISOString() }))
    if (!adicionados.length) { setColagem(''); return alert('Todos esses e-mails já estavam autorizados.') }
    // sai da lixeira quem estiver sendo autorizado agora
    const excluidos = (config.excluidos || []).filter((a) => !novos.includes(normalizarEmail(a.email)))
    const teste = (config.teste || []).filter((a) => !novos.includes(normalizarEmail(a.email)))
    onGravar({ autorizados: [...atuais, ...adicionados], excluidos, teste })
    setColagem('')
  }

  /**
   * Tirar dos autorizados coloca o e-mail na lista de teste EXPLICITAMENTE. Sem isso, um
   * e-mail cadastrado por colagem, que nunca chegou a fazer login, simplesmente sumia da tela:
   * ele não estava mais nos autorizados e também não tinha cadastro próprio pra aparecer em
   * teste. A contagem dos dias começa agora.
   */
  function moverParaTeste(email) {
    const e = normalizarEmail(email)
    if (!confirm(`Mover ${email} para teste? Ele volta a ter o período de avaliação.`)) return
    const teste = (config.teste || []).filter((a) => normalizarEmail(a.email) !== e)
    onGravar({
      autorizados: (config.autorizados || []).filter((a) => normalizarEmail(a.email) !== e),
      teste: [...teste, { email: e, desde: new Date().toISOString() }],
    })
  }

  return (
    <div>
      <label className="text-xs font-medium text-ink/70 block mb-1">Colar e-mails</label>
      <textarea
        value={colagem} onChange={(e) => setColagem(e.target.value)} rows={3}
        placeholder="Cole aqui vários e-mails de uma vez — separados por vírgula, espaço ou um por linha"
        className="w-full text-sm p-3 rounded-lg border border-line outline-none focus:border-clay mb-2"
      />
      <button onClick={adicionar} className="text-sm px-4 py-2 rounded-full bg-clay text-white font-medium mb-6">Autorizar</button>

      <TabelaUsuarios
        linhas={(config.autorizados || []).map((a) => ({ ...porEmail.get(normalizarEmail(a.email)), email: a.email, desde: a.desde }))}
        vazio="Nenhum e-mail autorizado ainda."
        colaboradores={colaboradores}
        acao={(l) => <button onClick={() => moverParaTeste(l.email)} className="text-xs text-clay hover:underline">mover para teste</button>}
      />
    </div>
  )
}

/* ---------------- Teste ---------------- */

function AbaTeste({ emTeste, config, colaboradores, onGravar }) {
  const dias = Number(config.suporte?.diasTeste) || 30

  function diasRestantes(a) {
    if (!a.desde) return dias
    const fim = new Date(new Date(a.desde).getTime() + dias * 24 * 60 * 60 * 1000)
    return Math.ceil((fim.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  }

  function autorizar(email) {
    const e = normalizarEmail(email)
    const atuais = config.autorizados || []
    if (atuais.some((a) => normalizarEmail(a.email) === e)) return
    onGravar({
      autorizados: [...atuais, { email: e, desde: new Date().toISOString() }],
      teste: (config.teste || []).filter((a) => normalizarEmail(a.email) !== e),
    })
  }

  function excluir(email) {
    const e = normalizarEmail(email)
    if (!confirm(`Bloquear ${email}? Ele não vai mais conseguir entrar, nem como teste.`)) return
    onGravar({
      excluidos: [...(config.excluidos || []), { email: e, em: new Date().toISOString() }],
      teste: (config.teste || []).filter((a) => normalizarEmail(a.email) !== e),
    })
  }

  return (
    <div>
      <p className="text-sm text-muted mb-4">
        Fizeram login mas ainda não foram autorizados. Passados os {dias} dias, ficam em vermelho e
        só conseguem consultar o que já criaram.
      </p>
      <TabelaUsuarios
        linhas={emTeste.map((a) => ({ ...a, restantes: diasRestantes(a) }))}
        vazio="Ninguém em teste no momento."
        corDaLinha={(l) => (l.restantes <= 0 ? '#B42318' : undefined)}
        colaboradores={colaboradores}
        colunaExtra={{ titulo: 'Teste', valor: (l) => (l.restantes > 0 ? `faltam ${l.restantes} dia(s)` : 'encerrado') }}
        acao={(l) => (
          <span className="flex gap-2 justify-end">
            <button onClick={() => autorizar(l.email)} className="text-xs text-[#16803C] hover:underline">autorizar</button>
            <button onClick={() => excluir(l.email)} className="text-xs text-red-600 hover:underline">excluir</button>
          </span>
        )}
      />
    </div>
  )
}

/* ---------------- Excluídos ---------------- */

function AbaExcluidos({ config, porEmail, colaboradores, onGravar, onRecarregar }) {
  const lista = config.excluidos || []

  function restaurar(email) {
    onGravar({ excluidos: lista.filter((a) => normalizarEmail(a.email) !== normalizarEmail(email)) })
  }

  /**
   * Apaga o CADASTRO da pessoa: o espaço dela é zerado (propostas, fotos, agenda e
   * configurações) e o período de teste recomeça do zero. Diferente de "restaurar", que
   * devolve o acesso com tudo como estava.
   *
   * A limpeza em si acontece no próximo login dela, feita pelo aplicativo dela — a
   * administradora não tem, e não deve ter, permissão de leitura sobre os dados de ninguém.
   * Se a pessoa nunca mais entrar, os dados dela continuam ocupando espaço e só saem pelo
   * Console do Firebase.
   */
  async function excluirCadastro(email) {
    const e = normalizarEmail(email)
    if (!confirm(`Excluir o cadastro de ${email}?\n\nTudo o que ele criou será apagado quando ele entrar de novo, e o período de teste recomeça do zero.`)) return
    const registro = porEmail.get(e)
    if (registro?.uid) await marcarParaZerar(registro.uid)
    onGravar({
      excluidos: lista.filter((a) => normalizarEmail(a.email) !== e),
      teste: (config.teste || []).filter((a) => normalizarEmail(a.email) !== e),
      autorizados: (config.autorizados || []).filter((a) => normalizarEmail(a.email) !== e),
    })
    onRecarregar()
  }

  async function esvaziar() {
    if (!confirm('Esvaziar a lixeira? Os e-mails saem da lista e voltam a poder entrar como teste, com o histórico que já tinham.')) return
    onGravar({ excluidos: [] })
    onRecarregar()
  }

  return (
    <div>
      <p className="text-sm text-muted mb-1">
        Não conseguem entrar, nem como teste.
      </p>
      <p className="text-sm text-muted mb-4">
        <strong>Restaurar</strong> devolve o acesso com o histórico intacto.{' '}
        <strong>Excluir cadastro</strong> zera o espaço dele: tudo o que criou é apagado no próximo
        login e o período de teste recomeça. Se ele nunca mais entrar, os dados só saem pelo Console
        do Firebase.
      </p>
      {lista.length > 0 && (
        <button onClick={esvaziar} className="text-sm px-4 py-2 rounded-full border border-line text-muted mb-4">🗑 Esvaziar lixeira (restaura todos)</button>
      )}
      <TabelaUsuarios
        linhas={lista.map((a) => ({ ...porEmail.get(normalizarEmail(a.email)), email: a.email, desde: a.em }))}
        vazio="A lixeira está vazia."
        colaboradores={colaboradores}
        acao={(l) => (
          <span className="flex gap-2 justify-end">
            <button onClick={() => restaurar(l.email)} className="text-xs text-clay hover:underline">restaurar</button>
            <button onClick={() => excluirCadastro(l.email)} className="text-xs text-red-600 hover:underline">excluir cadastro</button>
          </span>
        )}
      />
    </div>
  )
}

/* ---------------- Suporte ---------------- */

function AbaSuporte({ config, onGravar, salvando }) {
  const [s, setS] = useState({ ...SUPORTE_PADRAO, ...(config.suporte || {}) })
  const [colaboradores, setColaboradores] = useState((config.suporte?.colaboradores || []).join('\n'))

  function campo(k, label, props = {}) {
    return (
      <div className="mb-4">
        <label className="text-xs font-medium text-ink/70 block mb-1">{label}</label>
        {props.multi
          ? <textarea value={s[k] || ''} rows={props.rows || 3} onChange={(e) => setS({ ...s, [k]: e.target.value })} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay" />
          : <input value={s[k] || ''} onChange={(e) => setS({ ...s, [k]: e.target.value })} className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay" />}
        {props.dica && <p className="text-[11px] text-muted mt-1">{props.dica}</p>}
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-muted mb-5">Textos e contatos que aparecem para quem está em teste.</p>

      {campo('titulo', 'Título', { dica: 'Use {nome} para o nome do profissional.' })}
      {campo('mensagem', 'Mensagem', { multi: true, rows: 5, dica: 'Use {dias} para o tempo de teste.' })}
      {campo('whatsapp', 'WhatsApp do suporte')}
      {campo('email', 'E-mail do suporte')}
      {campo('diasTeste', 'Tempo de teste (dias)')}
      {campo('limiteMensal', 'Limite de propostas por mês', { dica: 'Vale para autorizados e colaboradores. Você não entra no limite.' })}
      {campo('limiteMensalTeste', 'Limite de propostas por mês — versão de teste', { dica: 'Menor de propósito: quem não converte deixa as propostas ocupando espaço.' })}
      {campo('botaoNome', 'Nome do botão de vendas')}
      {campo('botaoLink', 'Link de vendas')}

      <div className="mb-4">
        <label className="text-xs font-medium text-ink/70 block mb-1">E-mails de colaboração</label>
        <textarea
          value={colaboradores} onChange={(e) => setColaboradores(e.target.value)} rows={3}
          placeholder="Um por linha"
          className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
        />
        <p className="text-[11px] text-muted mt-1">
          Entram direto nas suas propostas e podem criar e editar. Não veem Configurações nem esta página.
        </p>
      </div>

      {campo('emailPrincipal', 'E-mail principal (administrador)')}
      <p className="text-[11px] text-muted -mt-2 mb-5">
        Este campo é informativo. O e-mail do administrador também está escrito dentro das regras do
        Firestore — sem isso, qualquer pessoa poderia se tornar administradora editando o próprio
        cadastro. Para trocar de verdade, o arquivo <code>firestore.rules</code> precisa ser alterado
        e publicado no Console do Firebase.
      </p>

      <button
        disabled={salvando}
        onClick={() => onGravar({ suporte: { ...s, diasTeste: Number(s.diasTeste) || 30, limiteMensal: Number(s.limiteMensal) || 6, limiteMensalTeste: Number(s.limiteMensalTeste) || 2, colaboradores: separarEmails(colaboradores) } })}
        className="text-sm px-5 py-2.5 rounded-full bg-clay text-white font-medium disabled:opacity-50"
      >{salvando ? 'Salvando…' : 'Salvar'}</button>
    </div>
  )
}

/* ---------------- tabela comum ---------------- */

function TabelaUsuarios({ linhas, vazio, acao, colunaExtra, corDaLinha, colaboradores }) {
  if (!linhas.length) return <p className="text-sm text-muted">{vazio}</p>
  return (
    <div className="overflow-x-auto border border-line rounded-xl bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted border-b border-line">
            <th className="p-3 font-medium">Início</th>
            <th className="p-3 font-medium">E-mail</th>
            <th className="p-3 font-medium">Profissional</th>
            <th className="p-3 font-medium">WhatsApp</th>
            <th className="p-3 font-medium">Propostas</th>
            {colunaExtra && <th className="p-3 font-medium">{colunaExtra.titulo}</th>}
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.email} className="border-b border-line last:border-0" style={{ color: corDaLinha?.(l) }}>
              <td className="p-3 whitespace-nowrap">{l.desde ? new Date(l.desde).toLocaleDateString('pt-BR') : '—'}</td>
              <td className="p-3">
                {colaboradores?.has(normalizarEmail(l.email)) && (
                  <span title="Colaborador: acessa as suas propostas" className="mr-1">⭐</span>
                )}
                {l.email}
              </td>
              <td className="p-3">{l.nome || '—'}</td>
              <td className="p-3 whitespace-nowrap">{l.whatsapp || '—'}</td>
              <td className="p-3">{l.propostas ?? '—'}</td>
              {colunaExtra && <td className="p-3 whitespace-nowrap">{colunaExtra.valor(l)}</td>}
              <td className="p-3 text-right whitespace-nowrap">{acao?.(l)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-muted p-3">
        Profissional, WhatsApp e propostas aparecem conforme cada pessoa preenche as Configurações e cria propostas.
        {colaboradores?.size > 0 && ' ⭐ marca os colaboradores, que trabalham nas suas propostas.'}
      </p>
    </div>
  )
}

/**
 * Espaço ocupado pelas fotos. O Firebase não mostra esse número no plano gratuito, e é
 * justamente o limite que aperta primeiro: 1 GiB para a conta inteira.
 *
 * Contar exige ler os documentos das fotos, o que consome cota — então é um botão que a
 * pessoa aperta quando quer, e não algo que roda sozinho toda vez que a tela abre. Seria
 * irônico um medidor de consumo virar ele mesmo uma fonte de consumo.
 */
function PainelDeEspaco() {
  const [dados, setDados] = useState(() => lerMedicaoSalva())
  const [medindo, setMedindo] = useState(() => medicaoEstaRodando())
  const [erro, setErro] = useState('')
  const [progresso, setProgresso] = useState(() => lerProgressoMedicao())

  const LIMITE = 1024 * 1024 * 1024 // 1 GiB do plano gratuito

  // se a medição já estava rodando quando esta tela abriu (porque a pessoa saiu e voltou),
  // a gente se pendura nela em vez de começar outra
  useEffect(() => {
    if (!medicaoEstaRodando()) return
    setMedindo(true)
    setProgresso(lerProgressoMedicao())
    iniciarMedicaoEspaco(setProgressoDaTela).then(setDados).catch(() => {}).finally(() => setMedindo(false))
  }, [])

  function setProgressoDaTela(feitas, total) { setProgresso({ feitas, total }) }

  async function medir() {
    setMedindo(true)
    setErro('')
    try {
      setDados(await iniciarMedicaoEspaco(setProgressoDaTela))
    } catch (err) {
      console.error(err)
      // mostra o erro de verdade: "Não consegui medir agora" não dizia nada sobre a causa
      setErro(err?.message || 'erro desconhecido')
    } finally {
      setMedindo(false)
    }
  }

  const medidoEm = dados?.em ? new Date(dados.em) : null

  const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  const pct = dados ? Math.min((dados.totalBytes / LIMITE) * 100, 100) : 0
  const cor = pct >= 80 ? '#B42318' : pct >= 50 ? '#B45309' : '#16803C'

  return (
    <div className="mb-8 p-4 border border-line rounded-xl bg-white max-w-2xl">
      <h3 className="font-medium text-ink text-sm mb-1">Espaço usado pelas fotos</h3>
      <p className="text-[11px] text-muted mb-3">
        O plano gratuito do Firebase dá 1 GB para a conta inteira, e é o limite que aperta primeiro.
        A medição lê os documentos das fotos, então só roda quando você pedir.
      </p>

      {erro && (
        <p className="text-[11px] mb-3 p-2 rounded-lg" style={{ background: '#FDEEEC', color: '#B42318' }}>
          Não consegui concluir a medição: {erro}
        </p>
      )}

      {medindo && (
        <p className="text-[11px] text-muted mb-3">
          Medindo{progresso.total ? ` — proposta ${progresso.feitas} de ${progresso.total}` : '…'}.
          Pode sair desta tela: a medição continua e o resultado fica esperando aqui.
        </p>
      )}

      {!dados ? (
        <button onClick={medir} disabled={medindo} className="text-sm px-4 py-2 rounded-full bg-ink text-white disabled:opacity-50">
          {medindo ? 'Medindo…' : '📊 Medir agora'}
        </button>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="font-display text-2xl" style={{ color: cor }}>{mb(dados.totalBytes)}</span>
            <span className="text-sm text-muted">de 1 GB · {dados.totalFotos} fotos</span>
          </div>
          <div className="h-2 rounded-full bg-line overflow-hidden mb-1">
            <div className="h-full transition-all" style={{ width: `${Math.max(pct, 1)}%`, background: cor }} />
          </div>
          <p className="text-[11px] text-muted mb-1">
            {pct.toFixed(1)}% do limite · estimativa a partir do peso médio das fotos
          </p>
          <p className="text-[11px] text-muted mb-4">
            Medido em {medidoEm?.toLocaleString('pt-BR')} · o resultado fica guardado por 24 horas
            {dados.falhas > 0 && ` · ${dados.falhas} grupo(s) de fotos não puderam ser lidos e ficaram de fora`}
          </p>

          <div className="text-sm text-ink/80 mb-1">
            Biblioteca da conta (fotos que valem para todas as propostas): {dados.biblioteca.quantidade} fotos · {mb(dados.biblioteca.bytes)}
          </div>

          {dados.porProposta.length > 0 && (
            <div className="mt-3 border-t border-line pt-3">
              <div className="text-xs font-medium text-ink/70 mb-2">Por proposta (da mais pesada para a mais leve)</div>
              {dados.porProposta.map((p) => (
                <div key={p.id} className="flex justify-between gap-3 text-sm text-ink/80 mb-1">
                  <span className="truncate">{p.nome}{p.encerrada && ' (encerrada)'}</span>
                  <span className="shrink-0 text-muted">{p.quantidade} fotos · {mb(p.bytes)}</span>
                </div>
              ))}
            </div>
          )}

          <button onClick={medir} disabled={medindo} className="text-xs text-clay mt-3 disabled:opacity-50">
            {medindo ? 'Medindo…' : 'medir de novo'}
          </button>
        </>
      )}
    </div>
  )
}
