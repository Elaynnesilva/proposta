import React, { useEffect, useMemo, useState } from 'react'
import {
  lerConfigAcesso, salvarConfigAcesso, listarAcessos, apagarAcesso,
  separarEmails, normalizarEmail, SUPORTE_PADRAO,
} from '../lib/acesso'

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
    setConfig(c)
    setAcessos(a)
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

  const emailsAutorizados = useMemo(
    () => new Set((config?.autorizados || []).map((a) => normalizarEmail(a.email))),
    [config],
  )
  const emailsExcluidos = useMemo(
    () => new Set((config?.excluidos || []).map((a) => normalizarEmail(a.email))),
    [config],
  )

  // quem entrou e ainda não está em nenhuma lista está em teste
  const emTeste = useMemo(
    () => acessos.filter((a) => {
      const e = normalizarEmail(a.email)
      if (!e || e === normalizarEmail(config?.suporte?.emailPrincipal)) return false
      return !emailsAutorizados.has(e) && !emailsExcluidos.has(e)
    }),
    [acessos, emailsAutorizados, emailsExcluidos, config],
  )

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
        <AbaAutorizados config={config} porEmail={porEmail} onGravar={gravar} salvando={salvando} />
      )}
      {aba === 'teste' && (
        <AbaTeste
          emTeste={emTeste} config={config} onGravar={gravar}
          onRecarregar={recarregar}
        />
      )}
      {aba === 'excluidos' && (
        <AbaExcluidos config={config} porEmail={porEmail} onGravar={gravar} onRecarregar={recarregar} />
      )}
      {aba === 'suporte' && <AbaSuporte config={config} onGravar={gravar} salvando={salvando} />}
    </div>
  )
}

/* ---------------- Autorizados ---------------- */

function AbaAutorizados({ config, porEmail, onGravar }) {
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
    onGravar({ autorizados: [...atuais, ...adicionados], excluidos })
    setColagem('')
  }

  function remover(email) {
    if (!confirm(`Tirar ${email} dos autorizados? Ele volta a contar como teste.`)) return
    onGravar({ autorizados: (config.autorizados || []).filter((a) => normalizarEmail(a.email) !== normalizarEmail(email)) })
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
        acao={(l) => <button onClick={() => remover(l.email)} className="text-xs text-red-600 hover:underline">remover</button>}
      />
    </div>
  )
}

/* ---------------- Teste ---------------- */

function AbaTeste({ emTeste, config, onGravar }) {
  const dias = Number(config.suporte?.diasTeste) || 30

  function diasRestantes(a) {
    if (!a.desde) return dias
    const fim = new Date(new Date(a.desde).getTime() + dias * 24 * 60 * 60 * 1000)
    return Math.ceil((fim.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  }

  function autorizar(email) {
    const atuais = config.autorizados || []
    if (atuais.some((a) => normalizarEmail(a.email) === normalizarEmail(email))) return
    onGravar({ autorizados: [...atuais, { email: normalizarEmail(email), desde: new Date().toISOString() }] })
  }

  function excluir(email) {
    if (!confirm(`Bloquear ${email}? Ele não vai mais conseguir entrar, nem como teste.`)) return
    onGravar({ excluidos: [...(config.excluidos || []), { email: normalizarEmail(email), em: new Date().toISOString() }] })
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

function AbaExcluidos({ config, porEmail, onGravar, onRecarregar }) {
  const lista = config.excluidos || []

  function restaurar(email) {
    onGravar({ excluidos: lista.filter((a) => normalizarEmail(a.email) !== normalizarEmail(email)) })
  }

  async function esvaziar() {
    if (!confirm('Esvaziar a lixeira? Os e-mails somem da lista e voltam a poder entrar como teste.')) return
    await Promise.all(lista.map(async (a) => {
      const registro = porEmail.get(normalizarEmail(a.email))
      if (registro?.uid) await apagarAcesso(registro.uid)
    }))
    onGravar({ excluidos: [] })
    onRecarregar()
  }

  return (
    <div>
      <p className="text-sm text-muted mb-4">
        Não conseguem entrar, nem como teste. Restaurar devolve o e-mail ao estado de teste.
      </p>
      {lista.length > 0 && (
        <button onClick={esvaziar} className="text-sm px-4 py-2 rounded-full border border-line text-red-600 mb-4">🗑 Esvaziar lixeira</button>
      )}
      <TabelaUsuarios
        linhas={lista.map((a) => ({ ...porEmail.get(normalizarEmail(a.email)), email: a.email, desde: a.em }))}
        vazio="A lixeira está vazia."
        acao={(l) => <button onClick={() => restaurar(l.email)} className="text-xs text-clay hover:underline">restaurar</button>}
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
        onClick={() => onGravar({ suporte: { ...s, diasTeste: Number(s.diasTeste) || 30, colaboradores: separarEmails(colaboradores) } })}
        className="text-sm px-5 py-2.5 rounded-full bg-clay text-white font-medium disabled:opacity-50"
      >{salvando ? 'Salvando…' : 'Salvar'}</button>
    </div>
  )
}

/* ---------------- tabela comum ---------------- */

function TabelaUsuarios({ linhas, vazio, acao, colunaExtra, corDaLinha }) {
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
              <td className="p-3">{l.email}</td>
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
      </p>
    </div>
  )
}
