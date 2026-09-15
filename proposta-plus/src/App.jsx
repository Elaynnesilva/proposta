import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { subscribeAuth, definirContaDeTrabalho, listProposals, getSettings, apagarTodosOsDadosDaConta } from './lib/db'
import { lerConfigAcesso, registrarAcesso, resolverPapel, salvarConfigAcesso, concluirZeragem } from './lib/acesso'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import Agenda from './pages/Agenda'
import Settings from './pages/Settings'
import Presenter from './pages/Presenter'
import Usuarios from './pages/Usuarios'
import BloqueioAcesso from './pages/BloqueioAcesso'

export default function App() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)
  const [acesso, setAcesso] = useState(null)

  useEffect(() => {
    const unsubscribe = subscribeAuth((u) => {
      setUser(u)
      setChecking(false)
      if (!u) { setAcesso(null); definirContaDeTrabalho(null) }
    })
    return unsubscribe
  }, [])

  /**
   * Descobre, a cada login, em que situação a pessoa está (dona, colaboradora, autorizada,
   * em teste ou bloqueada) e em qual espaço de dados ela vai trabalhar. O colaborador é o
   * único que não usa o próprio espaço: ele cai direto nas propostas da dona.
   *
   * Aqui também é registrado quem entrou — é desse registro que saem a data de início do
   * teste e as colunas da tabela em "Usuários do sistema".
   */
  useEffect(() => {
    if (!user) return
    let cancelado = false
    ;(async () => {
      const config = await lerConfigAcesso()
      const registro = await registrarAcesso()
      if (cancelado) return
      const papel = resolverPapel({ config, user, acesso: registro })
      definirContaDeTrabalho(papel.contaDeDados)

      /**
       * Cadastro marcado como "excluir cadastro" pela administradora: o espaço é zerado aqui,
       * pelo aplicativo da própria pessoa — ela é a única com permissão sobre os próprios
       * dados. Depois disso o teste recomeça do zero. Quem continua bloqueado não passa por
       * aqui: nada é apagado enquanto o e-mail estiver na lixeira.
       */
      if (registro?.zerar && papel.papel !== 'excluido' && papel.papel !== 'colaborador') {
        try {
          await apagarTodosOsDadosDaConta()
          await concluirZeragem()
        } catch (err) { console.error(err) }
        if (cancelado) return
        const novoRegistro = await registrarAcesso()
        const novoPapel = resolverPapel({ config, user, acesso: novoRegistro })
        definirContaDeTrabalho(novoPapel.contaDeDados)
        setAcesso({ ...novoPapel, config })
        return
      }

      setAcesso({ ...papel, config })

      // a dona grava o próprio uid nas configurações: é por ele que o colaborador sabe
      // qual espaço abrir
      if (papel.papel === 'dono' && config.donoUid !== user.uid) {
        salvarConfigAcesso({ ...config, donoUid: user.uid }).catch(() => {})
      }

      // completa o registro com o que alimenta a tabela (nome, WhatsApp e nº de propostas)
      if (papel.papel !== 'colaborador') {
        try {
          const [settings, propostas] = await Promise.all([getSettings(), listProposals()])
          await registrarAcesso({
            nome: settings?.professionalName || '',
            whatsapp: settings?.whatsapp || '',
            propostas: propostas.length,
          })
        } catch { /* sem permissão ainda: a tabela mostra "—" até a próxima entrada */ }
      }
    })()
    return () => { cancelado = true }
  }, [user])

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sand text-muted text-sm">
        Carregando…
      </div>
    )
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/ver/:uid/:id" element={<Presenter />} />
        <Route path="*" element={<Login onAuth={setUser} />} />
      </Routes>
    )
  }

  if (!acesso) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-sand text-muted text-sm">
        Carregando…
      </div>
    )
  }

  if (acesso.papel === 'excluido') {
    return <BloqueioAcesso acesso={acesso} />
  }

  const ehDono = acesso.papel === 'dono'

  return (
    <Routes>
      <Route path="/proposta/:id/apresentar" element={<Presenter />} />
      <Route path="/ver/:uid/:id" element={<Presenter />} />
      <Route
        path="*"
        element={
          <Layout user={user} acesso={acesso}>
            <Routes>
              <Route path="/" element={<Dashboard acesso={acesso} />} />
              <Route path="/proposta/:id/editar" element={<Editor />} />
              <Route path="/agenda" element={<Agenda />} />
              {acesso.papel !== 'colaborador' && <Route path="/configuracoes" element={<Settings />} />}
              {ehDono && <Route path="/usuarios" element={<Usuarios />} />}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  )
}
