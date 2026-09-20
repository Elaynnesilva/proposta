import React, { useEffect, useRef, useState } from 'react'
import { getSettings, saveSettings, getTemplateContent, saveTemplateContent, listProposals, saveProposal, getProposal, limparFotosOrfas } from '../lib/db'
import { DEFAULT_SHARED_TEXT, DEFAULT_IMAGES, TIPOLOGIAS } from '../lib/content'
import RecorteLogo from '../components/RecorteLogo'

const TABS = [
  { id: 'empresa', label: 'Empresa' },
  { id: 'imagens', label: 'Imagens da proposta' },
]

export default function Settings() {
  const [tab, setTab] = useState('empresa')
  const [settings, setSettings] = useState(null)
  const [content, setContent] = useState(null)
  const [savedTick, setSavedTick] = useState(false)
  const [arquivoLogo, setArquivoLogo] = useState(null) // arquivo escolhido, aguardando o recorte
  const faviconPadraoRef = useRef(null) // ícone da aba do navegador antes de qualquer logo enviada

  useEffect(() => {
    // guarda o favicon original só na primeira vez, pra poder devolver ao remover a logo
    const fav = document.getElementById('favicon')
    if (fav && faviconPadraoRef.current === null) faviconPadraoRef.current = fav.href
    getSettings().then(setSettings)
    getTemplateContent().then((c) => setContent({
      shared: { ...DEFAULT_SHARED_TEXT, ...(c?.shared || {}) },
      images: {
        residencial: { ...DEFAULT_IMAGES.residencial, ...(c?.images?.residencial || {}) },
        comercial: { ...DEFAULT_IMAGES.comercial, ...(c?.images?.comercial || {}) },
        corporativo: { ...DEFAULT_IMAGES.corporativo, ...(c?.images?.corporativo || {}) },
      },
    }))
  }, [])

  function flashSaved() {
    setSavedTick(true)
    setTimeout(() => setSavedTick(false), 1200)
  }

  async function persistSettings(patch) {
    const next = { ...settings, ...patch }
    setSettings(next)
    await saveSettings(next)
    flashSaved()
  }

  async function persistContent(patch) {
    const next = { ...content, ...patch }
    setContent(next)
    await saveTemplateContent(next)
    flashSaved()
  }

  /** Chamado depois que a pessoa ajusta o recorte circular — já chega pronta em base64 */
  function confirmarLogo(dataUrl) {
    persistSettings({ logoDataUrl: dataUrl })
    const fav = document.getElementById('favicon')
    if (fav) fav.href = dataUrl
    setArquivoLogo(null)
  }

  function removerLogo() {
    if (!confirm('Remover a logo atual? A apresentação e o painel voltam a aparecer sem ela.')) return
    persistSettings({ logoDataUrl: '' })
    const fav = document.getElementById('favicon')
    if (fav && faviconPadraoRef.current) fav.href = faviconPadraoRef.current
  }

  if (!settings || !content) return <div className="p-10 text-muted">Carregando…</div>

  return (
    <div className="max-w-4xl mx-auto p-6 md:p-10">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl text-ink">Configurações</h1>
          <p className="text-sm text-muted mt-1">Sua marca e o conteúdo padrão usados em todas as propostas.</p>
        </div>
        <span className="text-xs text-muted">{savedTick ? 'Salvo ✓' : ''}</span>
      </div>

      <div className="flex gap-1 mb-8 border-b border-line overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id} onClick={() => setTab(t.id)}
            className={`text-sm px-4 py-2.5 whitespace-nowrap border-b-2 -mb-px transition ${tab === t.id ? 'border-clay text-ink font-medium' : 'border-transparent text-muted hover:text-ink'}`}
          >{t.label}</button>
        ))}
      </div>

      {tab === 'empresa' && (
        <div className="max-w-xl space-y-6">
          <div>
            <label className="text-sm font-medium text-ink block mb-2">Logo / ícone do sistema</label>
            <div className="flex items-center gap-4">
              {settings.logoDataUrl
                ? <img src={settings.logoDataUrl} alt="logo" className="h-16 object-contain bg-sand rounded-lg p-2" />
                : <div className="h-16 w-16 rounded-lg bg-sand flex items-center justify-center text-xs text-muted">sem logo</div>}
              <div className="flex flex-col items-start gap-1.5">
                <label className="text-sm cursor-pointer text-clay font-medium">
                  Enviar imagem
                  <input
                    type="file" accept="image/*" hidden
                    onChange={(e) => {
                      if (e.target.files[0]) setArquivoLogo(e.target.files[0])
                      e.target.value = '' // permite escolher o mesmo arquivo de novo, se ela cancelar o recorte
                    }}
                  />
                </label>
                {settings.logoDataUrl && (
                  <button onClick={removerLogo} className="text-sm text-red-600 hover:underline flex items-center gap-1">
                    🗑 Remover
                  </button>
                )}
              </div>
            </div>
          </div>

          <Field label="Nome do escritório / marca" value={settings.companyName} onChange={(v) => persistSettings({ companyName: v })} />
          <Field label="Nome do(a) profissional" value={settings.professionalName} onChange={(v) => persistSettings({ professionalName: v })} />
          <Field label="Registro (CAU, CREA…)" value={settings.registration} onChange={(v) => persistSettings({ registration: v })} />
          <Field label="Cidade(s) de atuação" value={settings.city} onChange={(v) => persistSettings({ city: v })} />
          <Field label="Instagram" value={settings.instagram} onChange={(v) => persistSettings({ instagram: v })} />
          <Field label="WhatsApp" value={settings.whatsapp} onChange={(v) => persistSettings({ whatsapp: v })} />

          <div>
            <label className="text-xs font-medium text-ink/70 block mb-1">Fale sobre você</label>
            <textarea
              value={settings.bio || ''} rows={6}
              onChange={(e) => persistSettings({ bio: e.target.value })}
              placeholder="Sua formação, onde atua, o que guia o seu trabalho…"
              className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
            />
            <p className="text-[11px] text-muted mt-1">
              É o texto do slide "sobre mim" da apresentação. Editar por lá também atualiza aqui.
            </p>
          </div>
        </div>
      )}

      {tab === 'imagens' && <ImagensDaPropostaTab />}

      {arquivoLogo && (
        <RecorteLogo file={arquivoLogo} onCancelar={() => setArquivoLogo(null)} onConfirmar={confirmarLogo} />
      )}
    </div>
  )
}

function Field({ label, value, onChange }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-1">{label}</label>
      <input
        value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
      />
    </div>
  )
}

function TextBlock({ label, value, onChange }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-1">{label}</label>
      <input
        value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm p-2.5 rounded-lg border border-line outline-none focus:border-clay"
      />
    </div>
  )
}

function ListBlock({ label, items, onChange }) {
  return (
    <div>
      <label className="text-sm font-medium text-ink block mb-2">{label}</label>
      <div className="space-y-2">
        {items.map((it, i) => (
          <input
            key={i}
            value={it}
            onChange={(e) => {
              const next = [...items]
              next[i] = e.target.value
              onChange(next)
            }}
            className="w-full text-sm p-2 rounded-lg border border-line outline-none focus:border-clay"
          />
        ))}
      </div>
      <button onClick={() => onChange([...items, ''])} className="text-xs text-clay mt-2">+ adicionar item</button>
    </div>
  )
}

function PhotoSlot({ label, url, onFile }) {
  return (
    <label className="cursor-pointer group block">
      <div className="aspect-video rounded-lg overflow-hidden bg-sand border border-line relative">
        <img src={url} alt={label} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center">
          <span className="opacity-0 group-hover:opacity-100 text-white text-xs">Trocar foto</span>
        </div>
      </div>
      <input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
    </label>
  )
}

const TIPOLOGIA_LABELS = { residencial: 'Residencial', comercial: 'Comercial', corporativo: 'Corporativo' }

/** Vasculha os overrides de uma proposta e devolve uma lista plana de imagens editáveis,
 *  cada uma já sabendo como salvar de volta no lugar certo (cobre capa, sobre mim,
 *  solicitação do cliente, motivos, agenda, escopo/modelagem, jornada e resumo dos pacotes). */
function collectProposalImages(proposal, onSave) {
  const ov = proposal.slideOverrides || {}
  const list = []

  const singleSlots = [
    ['cover', 'Capa'], ['about', 'Sobre mim'], ['client-request', 'Solicitação do cliente'],
    ['reasons', 'Motivos'], ['agenda', 'O que será apresentado'],
  ]
  singleSlots.forEach(([slideId, label]) => {
    const url = ov[slideId]?.image
    if (url) {
      list.push({
        key: `${slideId}-image`, label, url,
        onReplace: (dataUrl) => onSave({ slideOverrides: { ...ov, [slideId]: { ...ov[slideId], image: dataUrl } } }),
      })
    }
  })

  Object.entries(ov).forEach(([slideId, patch]) => {
    if (Array.isArray(patch.images)) {
      patch.images.forEach((img, i) => {
        if (!img?.url) return
        list.push({
          key: `${slideId}-img-${i}`, label: `${slideId} — imagem ${i + 1}`, url: img.url,
          onReplace: (dataUrl) => {
            const images = patch.images.map((im, k) => (k === i ? { ...im, url: dataUrl } : im))
            onSave({ slideOverrides: { ...ov, [slideId]: { ...patch, images } } })
          },
        })
      })
    }
    if (Array.isArray(patch.stepImages)) {
      patch.stepImages.forEach((url, i) => {
        if (!url) return
        list.push({
          key: `${slideId}-step-${i}`, label: `Jornada — etapa ${i + 1}`, url,
          onReplace: (dataUrl) => {
            const stepImages = patch.stepImages.map((u, k) => (k === i ? dataUrl : u))
            onSave({ slideOverrides: { ...ov, [slideId]: { ...patch, stepImages } } })
          },
        })
      })
    }
    if (patch.packageExtras) {
      Object.entries(patch.packageExtras).forEach(([pkgId, extra]) => {
        if (!extra?.image) return
        list.push({
          key: `${slideId}-pkg-${pkgId}`, label: `Resumo — pacote ${pkgId}`, url: extra.image,
          onReplace: (dataUrl) => {
            const packageExtras = { ...patch.packageExtras, [pkgId]: { ...extra, image: dataUrl } }
            onSave({ slideOverrides: { ...ov, [slideId]: { ...patch, packageExtras } } })
          },
        })
      })
    }
  })

  return list
}

function ImagensDaPropostaTab() {
  const [proposals, setProposals] = useState(null)
  const [templateImages, setTemplateImages] = useState(null)
  const [openTipologia, setOpenTipologia] = useState('residencial')

  useEffect(() => { refresh() }, [openTipologia])

  /**
   * As fotos não são guardadas dentro do documento da proposta: lá fica só uma referência
   * curta ("firestoremedia://…"), e a foto de verdade vem de uma subcoleção. listProposals
   * devolve o documento cru (é o que o painel de propostas precisa, e buscar todas as fotos
   * ali seria lento), então as miniaturas apareciam quebradas aqui. Por isso recarregamos
   * com getProposal — que troca as referências pelas fotos — só as propostas da tipologia
   * aberta, e só quando esta aba está na tela.
   */
  async function refresh() {
    setProposals(null)
    const todas = await listProposals()
    const daTipologia = todas.filter((p) => p.tipologia === openTipologia)
    const completas = await Promise.all(daTipologia.map((p) => getProposal(p.id).catch(() => null)))
    setProposals(completas.filter(Boolean))
    // fotos salvas "para todas as propostas" (ou para um tipo) não ficam na proposta, e sim
    // no conteúdo do modelo — elas também aparecem aqui, marcadas como padrão
    setTemplateImages(await getTemplateContent().catch(() => null))
  }

  async function savePatch(proposal, patch) {
    await saveProposal({ ...proposal, ...patch })
    refresh()
  }

  async function saveTemplatePatch(bucket, slideDefaults) {
    const next = { ...(templateImages || {}), slideDefaults }
    setTemplateImages(next)
    await saveTemplateContent(next)
    refresh()
  }

  if (proposals === null) return <p className="text-sm text-muted">Carregando…</p>

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-muted mb-4">
        Todas as imagens que você já adicionou nos slides de cada proposta aparecem aqui, organizadas por tipologia.
        Trocar uma imagem aqui atualiza direto na apresentação daquela proposta.
      </p>
      <LimpezaDeFotos onFim={refresh} />
      <div className="flex gap-2 mb-6">
        {TIPOLOGIAS.map((t) => (
          <button
            key={t.id} onClick={() => setOpenTipologia(t.id)}
            className={`text-sm px-4 py-2 rounded-full border ${openTipologia === t.id ? 'bg-ink text-white border-ink' : 'border-line text-ink/70 hover:bg-sand'}`}
          >{TIPOLOGIA_LABELS[t.id] || t.label}</button>
        ))}
      </div>

      {['all', openTipologia].map((bucket) => {
        const defaults = templateImages?.slideDefaults?.[bucket] || {}
        const imagens = collectProposalImages({ slideOverrides: defaults }, (patch) =>
          saveTemplatePatch(bucket, { ...(templateImages?.slideDefaults || {}), [bucket]: patch.slideOverrides })
        )
        if (imagens.length === 0) return null
        return (
          <div key={bucket} className="mb-8">
            <h3 className="text-sm font-medium text-ink mb-1">
              {bucket === 'all' ? 'Padrão — todas as propostas' : `Padrão — propostas do tipo ${TIPOLOGIA_LABELS[bucket] || bucket}`}
            </h3>
            <p className="text-[11px] text-muted mb-3">Trocar aqui muda em todas as propostas que usam este padrão.</p>
            <ImageGrid images={imagens} />
          </div>
        )
      })}

      {proposals.map((p) => {
        const images = collectProposalImages(p, (patch) => savePatch(p, patch))
        if (images.length === 0) return null
        return (
          <div key={p.id} className="mb-8">
            <h3 className="text-sm font-medium text-ink mb-3">{p.name || 'Sem nome'}</h3>
            <ImageGrid images={images} />
          </div>
        )
      })}
      {proposals.every((p) => collectProposalImages(p, () => {}).length === 0)
        && !['all', openTipologia].some((b) => collectProposalImages({ slideOverrides: templateImages?.slideDefaults?.[b] || {} }, () => {}).length > 0) && (
        <p className="text-sm text-muted">Nenhuma imagem adicionada ainda nas propostas desta tipologia.</p>
      )}
    </div>
  )
}

function ImageGrid({ images }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {images.map((img) => (
        <label key={img.key} className="cursor-pointer group">
          <div className="relative">
            <img src={img.url} alt="" className="w-full aspect-square object-cover rounded-lg border border-line bg-sand" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition rounded-lg flex items-center justify-center">
              <span className="text-white text-xs opacity-0 group-hover:opacity-100">trocar</span>
            </div>
          </div>
          <div className="text-[11px] text-muted mt-1 truncate">{img.label}</div>
          <input type="file" accept="image/*" hidden onChange={(e) => {
            const file = e.target.files[0]; if (!file) return
            const reader = new FileReader()
            reader.onload = () => img.onReplace(reader.result)
            reader.readAsDataURL(file)
          }} />
        </label>
      ))}
    </div>
  )
}

/**
 * Varredura das fotos que não são mais usadas por nenhuma proposta nem pelo conteúdo padrão.
 * Elas ficam guardadas ocupando espaço sem aparecer em lugar nenhum — normalmente sobras de
 * imagens trocadas ou removidas de um slide. O plano gratuito do Firebase dá 1 GiB para a
 * conta inteira, então vale passar aqui de vez em quando.
 */
function LimpezaDeFotos({ onFim }) {
  const [rodando, setRodando] = useState(false)
  const [resultado, setResultado] = useState(null)

  async function limpar() {
    if (!confirm('Procurar e apagar fotos que nenhuma proposta usa mais? As fotos em uso não são tocadas.')) return
    setRodando(true)
    try {
      const n = await limparFotosOrfas()
      setResultado(n)
      onFim?.()
    } catch (err) {
      console.error(err)
      alert('Não consegui concluir a limpeza agora. Tente de novo em alguns instantes.')
    } finally {
      setRodando(false)
    }
  }

  return (
    <div className="mb-6 p-3 border border-line rounded-lg bg-white">
      <button onClick={limpar} disabled={rodando} className="text-sm text-clay font-medium disabled:opacity-50">
        {rodando ? 'Procurando…' : '🧹 Liberar espaço — apagar fotos sem uso'}
      </button>
      {resultado !== null && (
        <p className="text-xs text-muted mt-1">
          {resultado > 0 ? `${resultado} foto(s) sem uso foram apagadas.` : 'Nenhuma foto sobrando — está tudo em uso.'}
        </p>
      )}
    </div>
  )
}
