/*! Dojô da Câmara — sincronização do progresso entre aparelhos (Gist secreto do GitHub) + backup manual.
 *  Fonte: DOJO/sincronizacao/sincronizar.js (instalar.mjs copia para o repositório como sincronizar-<hash>.js).
 *  Roda ANTES do Angular (o index.html só carrega o main depois que a primeira sincronização termina, no máximo ~4,5 s)
 *  e não depende de nenhum componente compilado. */
(function () {
  'use strict';
  if (window.__dojoSync) return;

  // ---------------------------------------------------------------- constantes
  var CH = 'dojo-camara-v1';
  // Só o que é PROGRESSO. Ficam de fora: chave de IA, tema, vozes, velocidades, catálogo de áudio, podcast gerado.
  var CHAVES = [CH, 'dojo-selecon-notas', 'dojo-discursivas', 'dojo-plano-feitos', 'dojo-audio-posicoes', 'dojo-video-posicoes'];
  var K_CFG = 'dojo-sync-cfg', K_BASE = 'dojo-sync-base', K_META = 'dojo-sync-meta', K_UNDO = 'dojo-sync-desfazer';
  var ARQ = 'dojo-progresso.json';
  var DESCR = 'Dojô da Câmara – progresso (não apague)';
  var API = 'https://api.github.com';
  var ESPERA_INICIAL = 4000;
  var URL_TOKEN = 'https://github.com/settings/tokens/new?description=' + encodeURIComponent('Dojô da Câmara – sincronização') + '&scopes=gist';

  // ---------------------------------------------------------------- armazenamento
  var LS = null;
  try { LS = window.localStorage; LS.getItem('dojo-sync-teste'); } catch (e) { LS = null; }
  if (!LS) {
    window.__dojoSync = { pronto: Promise.resolve(), app: false, desativado: true, abrir: function () {} };
    return;
  }
  var protoSet = Storage.prototype.setItem, protoDel = Storage.prototype.removeItem;
  function lsGet(k) { try { return LS.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { protoSet.call(LS, k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { protoDel.call(LS, k); } catch (e) { /* nada */ } }
  function lerJSON(k) { var s = lsGet(k); if (s == null) return undefined; try { return JSON.parse(s); } catch (e) { return undefined; } }

  function ehObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }
  function iguais(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var i;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (i = 0; i < a.length; i++) if (!iguais(a[i], b[i])) return false;
      return true;
    }
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (i = 0; i < ka.length; i++) {
      var k = ka[i];
      if (!Object.prototype.hasOwnProperty.call(b, k) || !iguais(a[k], b[k])) return false;
    }
    return true;
  }
  function uniao() {
    var vistos = {}, out = [];
    for (var i = 0; i < arguments.length; i++) {
      var o = arguments[i];
      if (!ehObj(o)) continue;
      Object.keys(o).forEach(function (k) { if (!vistos[k]) { vistos[k] = 1; out.push(k); } });
    }
    return out;
  }

  function lerCfg() { var c = lerJSON(K_CFG); return ehObj(c) && c.token && c.gist ? c : null; }
  function lerMeta() { var m = lerJSON(K_META); if (!ehObj(m)) m = {}; if (!ehObj(m.at)) m.at = {}; return m; }
  function gravarMeta(m) { lsSet(K_META, JSON.stringify(m)); }
  function lerBase() { var b = lerJSON(K_BASE); return ehObj(b) && ehObj(b.docs) ? { docs: b.docs, at: ehObj(b.at) ? b.at : {}, etag: b.etag || '', gist: b.gist || '' } : { docs: {}, at: {}, etag: '', gist: '' }; }
  // A base pertence a um Gist específico: só vale se o aparelho continuar ligado a esse mesmo Gist.
  function gravarBase(docs, at, etag, gist) { lsSet(K_BASE, JSON.stringify({ docs: docs, at: at || {}, etag: etag || '', gist: gist || (lerCfg() || {}).gist || '' })); }
  function ehChave(k) { return CHAVES.indexOf(k) >= 0; }

  function lerLocal() {
    var docs = {};
    CHAVES.forEach(function (k) { var v = lerJSON(k); if (v !== undefined && v !== null) docs[k] = v; });
    return { docs: docs, at: lerMeta().at };
  }

  // ---------------------------------------------------------------- mesclagem em 3 vias
  // base = último estado da nuvem que este aparelho já incorporou; l = daqui; r = da nuvem.
  // Só o que mudou em CADA lado desde a base entra em conflito; o resto é simplesmente aceito.
  function numAdit(b, l, r) { b = typeof b === 'number' ? b : 0; return Math.max(0, b + (l - b) + (r - b)); }

  function chaveItem(x) { return typeof x === 'object' ? JSON.stringify(x) : typeof x + ':' + x; }
  function mesclarLista(b, l, r) {
    var sb = {}, sl = {}, sr = {}, out = [], visto = {};
    (Array.isArray(b) ? b : []).forEach(function (x) { sb[chaveItem(x)] = 1; });
    l.forEach(function (x) { sl[chaveItem(x)] = 1; });
    r.forEach(function (x) { sr[chaveItem(x)] = 1; });
    [l, r].forEach(function (arr) {
      arr.forEach(function (x) {
        var k = chaveItem(x);
        if (visto[k]) return;
        visto[k] = 1;
        if (sb[k] && (!sl[k] || !sr[k])) return; // alguém removeu
        out.push(x);
      });
    });
    return out;
  }

  function mesclarHoje(b, l, r) {
    b = ehObj(b) ? b : {}; l = ehObj(l) ? l : {}; r = ehObj(r) ? r : {};
    if (l.data !== r.data) return (l.data || '') > (r.data || '') ? l : r;
    var out = { data: l.data };
    ['cartoes', 'questoes', 'lacunas'].forEach(function (k) {
      var bb = b.data === l.data ? (b[k] || 0) : 0;
      out[k] = numAdit(bb, l[k] || 0, r[k] || 0);
    });
    return out;
  }

  function mesclarPrincipal(b, l, r, ctx) {
    b = ehObj(b) ? b : {}; l = ehObj(l) ? l : {}; r = ehObj(r) ? r : {};
    var out = {};
    uniao(l, r, b).forEach(function (k) {
      if (k === 'sequencia' || k === 'ultimoDia' || k === 'hoje') return;
      var v = mesclarValor(CH, [k], b[k], l[k], r[k], ctx);
      if (v !== undefined) out[k] = v;
    });
    var ul = l.ultimoDia || '', ur = r.ultimoDia || '';
    var lado = ul > ur ? l : ur > ul ? r : ((l.sequencia || 0) >= (r.sequencia || 0) ? l : r);
    if (lado.sequencia !== undefined) out.sequencia = lado.sequencia;
    if (lado.ultimoDia !== undefined) out.ultimoDia = lado.ultimoDia;
    if (l.hoje !== undefined || r.hoje !== undefined || b.hoje !== undefined) out.hoje = mesclarHoje(b.hoje, l.hoje, r.hoje);
    return out;
  }

  function politica(chave, p, b, l, r, ctx) {
    if (chave === CH) {
      if (p.length === 0) return { v: mesclarPrincipal(b, l, r, ctx) };
      if (p[0] === 'cartoes' && p.length === 2 && ehObj(l) && ehObj(r)) {
        // mesmo cartão revisado nos dois: vale o que volta a aparecer antes (mais prudente)
        return { v: (l.proxima || '') <= (r.proxima || '') ? l : r };
      }
      if (p[0] === 'hansei' && p.length === 1 && Array.isArray(l) && Array.isArray(r)) {
        var u = mesclarLista(b, l, r);
        u = u.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, c) {
          var da = ehObj(a.x) && a.x.data || '', dc = ehObj(c.x) && c.x.data || '';
          return da < dc ? 1 : da > dc ? -1 : a.i - c.i;
        }).map(function (o) { return o.x; });
        return { v: u.slice(0, 60) };
      }
    }
    if (chave === 'dojo-discursivas' && p.length === 1 && typeof l === 'string' && typeof r === 'string') {
      // rascunho editado nos dois aparelhos: nunca perder texto — fica o mais novo em cima e o outro logo abaixo
      var novo = ctx.localMaisNovo ? l : r, velho = ctx.localMaisNovo ? r : l;
      if (novo.indexOf(velho) >= 0) return { v: novo };
      if (velho.indexOf(novo) >= 0) return { v: velho };
      return { v: novo + '\n\n— versão do outro aparelho —\n\n' + velho };
    }
    return null;
  }

  function mesclarNumero(chave, p, b, l, r, ctx) {
    if (chave === 'dojo-selecon-notas') return Math.max(l, r);
    if (chave === CH && (p[0] === 'quiz' || p[0] === 'erros' || (p.length === 1 && (p[0] === 'xp' || p[0] === 'pomodoros')))) return numAdit(b, l, r);
    return ctx.localMaisNovo ? l : r;
  }

  function mesclarValor(chave, p, b, l, r, ctx) {
    if (iguais(l, r)) return l;
    if (iguais(l, b)) return r;
    if (iguais(r, b)) return l;
    var pol = politica(chave, p, b, l, r, ctx);
    if (pol) return pol.v;
    if (ehObj(l) && ehObj(r)) {
      var bo = ehObj(b) ? b : {}, out = {};
      uniao(l, r, bo).forEach(function (k) {
        var v = mesclarValor(chave, p.concat([k]), bo[k], l[k], r[k], ctx);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if (Array.isArray(l) && Array.isArray(r)) return mesclarLista(b, l, r);
    if (typeof l === 'number' && typeof r === 'number') return mesclarNumero(chave, p, b, l, r, ctx);
    if (typeof l === 'boolean' && typeof r === 'boolean') return l || r;
    if (l === undefined) return r; // um lado apagou e o outro mudou: fica a mudança
    if (r === undefined) return l;
    return ctx.localMaisNovo ? l : r;
  }

  function mesclarDocs(base, local, remoto) {
    var out = { docs: {}, at: {} };
    CHAVES.forEach(function (k) {
      var b = base.docs[k], l = local.docs[k], r = remoto ? remoto.docs[k] : undefined;
      var atL = (local.at && local.at[k]) || 0, atR = (remoto && remoto.at && remoto.at[k]) || 0;
      var v = mesclarValor(k, [], b, l, r, { localMaisNovo: atL >= atR });
      if (v !== undefined) out.docs[k] = v;
      out.at[k] = Math.max(atL, atR);
    });
    return out;
  }

  // ---------------------------------------------------------------- rede (API do GitHub)
  function ErroSync(codigo, msg) { var e = new Error(msg || codigo); e.codigo = codigo; return e; }

  async function http(metodo, caminho, token, corpo, tempo, extra) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = ctl && tempo ? setTimeout(function () { ctl.abort(); }, tempo) : null;
    try {
      var h = { 'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json' };
      if (corpo) h['Content-Type'] = 'application/json';
      if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
      var r;
      try {
        r = await fetch(caminho.indexOf('http') === 0 ? caminho : API + caminho, { method: metodo, headers: h, body: corpo ? JSON.stringify(corpo) : undefined, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
      } catch (e) { throw ErroSync('rede', 'Sem conexão'); }
      if (r.status === 304) return { status: 304, etag: r.headers.get('ETag') };
      var dados = null;
      try { dados = await r.json(); } catch (e) { /* sem corpo */ }
      if (r.status === 401) throw ErroSync('token');
      if (r.status === 403 || r.status === 429) throw ErroSync(r.status === 429 || r.headers.get('X-RateLimit-Remaining') === '0' ? 'limite' : 'permissao');
      if (r.status === 404) throw ErroSync('naoachado');
      if (!r.ok) throw ErroSync('http', 'Erro ' + r.status);
      return { status: r.status, dados: dados, etag: r.headers.get('ETag') };
    } catch (e) {
      if (e && e.codigo) throw e;
      throw ErroSync('rede', 'Sem conexão');
    } finally { if (t) clearTimeout(t); }
  }

  // Lê o arquivo de progresso do Gist. Com etag e sem mudança na nuvem, devolve { naoMudou: true }.
  async function lerGist(cfg, tempo, etag) {
    var r = await http('GET', '/gists/' + encodeURIComponent(cfg.gist), cfg.token, null, tempo, etag ? { 'If-None-Match': etag } : null);
    if (r.status === 304) return { naoMudou: true, etag: etag };
    var f = r.dados && r.dados.files && r.dados.files[ARQ];
    if (!f) return { payload: null, etag: r.etag };
    var txt = f.content;
    if (f.truncated || typeof txt !== 'string') {
      var rr;
      try { rr = await fetch(f.raw_url, { cache: 'no-store' }); } catch (e) { throw ErroSync('rede'); }
      if (!rr.ok) throw ErroSync('http', 'Erro ' + rr.status);
      txt = await rr.text();
    }
    if (!txt || !txt.trim() || txt.trim() === '{}') return { payload: null, etag: r.etag };
    var p;
    try { p = JSON.parse(txt); } catch (e) { throw ErroSync('dados'); }
    if (!ehObj(p) || p.app !== 'dojo-camara' || !ehObj(p.docs)) throw ErroSync('dados');
    return { payload: p, etag: r.etag };
  }
  async function baixar(cfg, tempo) {
    var base = lerBase();
    if (base.gist && base.gist !== cfg.gist) base = { docs: {}, at: {}, etag: '', gist: '' };
    var r = await lerGist(cfg, tempo, base.etag);
    return r.naoMudou ? { igualBase: true, etag: base.etag } : r;
  }

  async function enviar(cfg, payload) {
    var files = {}; files[ARQ] = { content: JSON.stringify(payload) };
    var r = await http('PATCH', '/gists/' + encodeURIComponent(cfg.gist), cfg.token, { files: files }, 20000);
    return { etag: r.etag };
  }

  async function acharGist(token) {
    for (var pg = 1; pg <= 5; pg++) {
      var r = await http('GET', '/gists?per_page=100&page=' + pg, token, null, 15000);
      var lista = Array.isArray(r.dados) ? r.dados : [];
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].description === DESCR && lista[i].files && lista[i].files[ARQ]) return lista[i].id;
      }
      if (lista.length < 100) break;
    }
    return null;
  }
  async function criarGist(token) {
    var files = {}; files[ARQ] = { content: '{}' };
    try {
      var r = await http('POST', '/gists', token, { description: DESCR, public: false, files: files }, 20000);
      return r.dados.id;
    } catch (e) { if (e.codigo === 'naoachado') throw ErroSync('permissao'); throw e; }
  }

  // ---------------------------------------------------------------- estado, agendamento, aplicação local
  var S = { pronto: null, app: false };
  var resolverPronto = function () {};
  S.pronto = new Promise(function (res) { resolverPronto = res; });
  var congelado = false, timer = null, primeiroAgendamento = 0, emCurso = null, repetir = false, tentativas = 0;
  var ultimaTentativa = 0, estado = { tipo: 'desligado' }, recarregarAoVoltar = false;

  function msgErro(e) {
    switch (e && e.codigo) {
      case 'token': return 'A chave do GitHub não foi aceita (expirou ou foi apagada). Gere outra e cole de novo.';
      case 'permissao': return 'A chave não tem a permissão "gist". Gere outra marcando só essa opção.';
      case 'limite': return 'O GitHub limitou as consultas por agora. Tente de novo em alguns minutos.';
      case 'naoachado': return 'A cópia na nuvem não foi encontrada (o Gist foi apagado?).';
      case 'rede': return 'Sem conexão. Vai sincronizar quando a internet voltar.';
      case 'dados': return 'O arquivo na nuvem está ilegível. Nada foi sobrescrito.';
      default: return 'Não deu para sincronizar agora (' + ((e && e.message) || 'erro') + ').';
    }
  }

  function agendar() {
    if (!lerCfg()) return;
    var agora = Date.now();
    if (!primeiroAgendamento) primeiroAgendamento = agora;
    clearTimeout(timer);
    var espera = Math.min(20000, Math.max(1000, primeiroAgendamento + 90000 - agora));
    timer = setTimeout(function () { primeiroAgendamento = 0; sincronizar(); }, espera);
  }

  // Intercepta só as gravações das chaves de progresso (para saber quando sincronizar e para "congelar" na hora de recarregar).
  Storage.prototype.setItem = function (k, v) {
    if (this === LS && ehChave(k)) {
      if (congelado) return;
      var antes = null;
      try { antes = LS.getItem(k); } catch (e) { /* nada */ }
      protoSet.call(this, k, v);
      if (antes !== String(v) && lerCfg()) { // sem sincronização ligada não grava nada extra
        var m = lerMeta(); m.at[k] = Date.now(); gravarMeta(m);
        agendar();
      }
      return;
    }
    return protoSet.apply(this, arguments);
  };

  function guardarDesfazer(docs, motivo) {
    lsSet(K_UNDO, JSON.stringify({ ts: Date.now(), motivo: motivo, docs: docs }));
  }
  function aplicarDocs(docs, at, forcar) {
    var m = lerMeta();
    CHAVES.forEach(function (k) {
      if (docs[k] !== undefined) lsSet(k, JSON.stringify(docs[k])); else lsDel(k);
      if (at && at[k]) m.at[k] = at[k];
    });
    gravarMeta(m);
    if (S.app || forcar) congelado = true; // o Angular já carregou o estado antigo: não deixa ele sobrescrever antes do reload
  }

  function podeRecarregar() {
    var a = [];
    try { a = JSON.parse(sessionStorage.getItem('dojo-sync-rec') || '[]'); } catch (e) { a = []; }
    var agora = Date.now();
    a = a.filter(function (t) { return agora - t < 60000; });
    if (a.length >= 2) return false;
    a.push(agora);
    try { sessionStorage.setItem('dojo-sync-rec', JSON.stringify(a)); } catch (e) { /* nada */ }
    return true;
  }
  function recarregar(texto) {
    if (document.visibilityState === 'hidden') { recarregarAoVoltar = true; return; }
    if (!podeRecarregar()) { congelado = false; aviso('Há progresso novo de outro aparelho. Recarregue a página para ver.'); return; }
    sobreposicao(texto || 'Atualizando seu progresso…');
    setTimeout(function () { location.replace(location.pathname + location.search); }, 250); // URL limpa: não reaparece a âncora do link
  }

  function defEstado(tipo, msg) {
    estado = { tipo: tipo, msg: msg || '', ts: Date.now() };
    atualizarBotao();
    if (painelAberto) renderPainel();
  }

  function sincronizar(opts) {
    opts = opts || {};
    var cfg = lerCfg();
    if (!cfg) { if (opts.inicial) resolverPronto(); return Promise.resolve({ tipo: 'desligado' }); }
    if (emCurso) { repetir = true; if (opts.inicial) resolverPronto(); return emCurso; }
    ultimaTentativa = Date.now();
    if (opts.inicial) setTimeout(resolverPronto, ESPERA_INICIAL); // o app não espera mais que isso; a resposta tardia ainda é aplicada
    var fim = function (r) { emCurso = null; if (repetir) { repetir = false; setTimeout(function () { sincronizar(); }, 50); } return r; };
    var rodar = function () { return executar(cfg, opts); };
    var p = (navigator.locks && navigator.locks.request) ? navigator.locks.request('dojo-sync', rodar) : rodar();
    emCurso = p.then(fim, fim);
    return emCurso;
  }

  async function executar(cfg, opts) {
    cfg = lerCfg() || cfg; // outra aba pode ter mudado
    defEstado('sincronizando');
    var b, remoto = null, etag = '';
    try {
      b = await baixar(cfg, opts.inicial ? 20000 : 15000);
    } catch (e) {
      if (opts.inicial) resolverPronto();
      return falhou(e);
    }
    var base = lerBase(), local = lerLocal();
    if (base.gist && base.gist !== cfg.gist) base = { docs: {}, at: {}, etag: '', gist: '' }; // base de outro Gist não serve
    if (b.igualBase) { remoto = { docs: base.docs, at: base.at }; etag = base.etag; }
    else if (b.payload) { remoto = { docs: b.payload.docs, at: ehObj(b.payload.at) ? b.payload.at : {} }; etag = b.etag || ''; }
    else { etag = b.etag || ''; base = { docs: {}, at: {}, etag: '' }; } // nuvem vazia: nada a apagar por "diferença"
    var fundido = mesclarDocs(base, local, remoto);
    var mudouLocal = !iguais(fundido.docs, local.docs);
    var mudouRemoto = !remoto || !iguais(fundido.docs, remoto.docs);
    var appNaAplicacao = S.app;
    if (mudouLocal) { guardarDesfazer(local.docs, 'sincronização'); aplicarDocs(fundido.docs, fundido.at); }
    if (opts.inicial) resolverPronto();
    try {
      if (mudouRemoto) {
        var payload = { app: 'dojo-camara', v: 1, ts: Date.now(), dev: cfg.dev, docs: fundido.docs, at: fundido.at };
        var env = await enviar(cfg, payload);
        gravarBase(fundido.docs, fundido.at, env.etag);
      } else {
        gravarBase(fundido.docs, fundido.at, etag);
      }
    } catch (e) {
      // o que veio da nuvem já está incorporado; o que é daqui sobe na próxima
      gravarBase(remoto ? remoto.docs : {}, remoto ? remoto.at : {}, remoto ? etag : '');
      if (mudouLocal && appNaAplicacao) recarregar();
      return falhou(e);
    }
    tentativas = 0;
    var m = lerMeta(); m.ultimoSync = Date.now(); gravarMeta(m);
    defEstado('ok');
    if (mudouLocal && appNaAplicacao) recarregar();
    return { tipo: 'ok', mudouLocal: mudouLocal };
  }

  function falhou(e) {
    var rede = e && e.codigo === 'rede';
    defEstado(rede ? 'offline' : 'erro', msgErro(e));
    if (rede || (e && e.codigo === 'http')) {
      tentativas++;
      setTimeout(function () { if (navigator.onLine !== false) sincronizar(); }, Math.min(300000, 15000 * Math.pow(2, Math.min(tentativas, 5))));
    }
    return { tipo: 'erro', erro: e };
  }

  // ---------------------------------------------------------------- ligar / desligar / backup
  function novoId() { return Math.random().toString(36).slice(2, 10); }
  function limparToken(t) { return String(t || '').replace(/\s+/g, '').replace(/^Bearer/i, ''); }

  // Já com a chave e o Gist definidos (ver inspecionar). "mesmo" = religando ao mesmo Gist: mantém a base (não soma de novo).
  async function ligar(token, gist, modo, mesmo) {
    token = limparToken(token);
    var id = gist || await criarGist(token);
    var antigo = lerCfg();
    lsSet(K_CFG, JSON.stringify({ token: token, gist: id, dev: (mesmo && antigo && antigo.dev) || novoId(), desde: Date.now() }));
    if (!mesmo) lsDel(K_BASE);
    if (modo === 'nuvem' && !mesmo) {
      var b = await baixar(lerCfg(), 20000);
      if (b.payload) {
        guardarDesfazer(lerLocal().docs, 'ligar usando só a nuvem');
        aplicarDocs(b.payload.docs, b.payload.at, true);
        gravarBase(b.payload.docs, ehObj(b.payload.at) ? b.payload.at : {}, b.etag || '', id);
        var m = lerMeta(); m.ultimoSync = Date.now(); gravarMeta(m);
        defEstado('ok');
        recarregar('Trazendo seu progresso da nuvem…');
        return { id: id, recarrega: true };
      }
    }
    var r = await sincronizar();
    if (r && r.erro) throw r.erro;
    return { id: id, recarrega: !!(r && r.mudouLocal) };
  }

  // Confere a chave, descobre de qual conta é e se já existe cópia na nuvem — antes de ligar qualquer coisa.
  async function inspecionar(o) {
    var token = limparToken(o.t);
    if (!/^[A-Za-z0-9_]{20,}$/.test(token)) throw ErroSync('token');
    var u = await http('GET', '/user', token, null, 15000);
    var id = o.g || await acharGist(token) || '';
    var remoto = null;
    if (id) { var r = await lerGist({ token: token, gist: id }, 20000, ''); remoto = r.payload || null; }
    var atual = lerCfg(), bs = lerBase();
    return { token: token, login: (u.dados && u.dados.login) || '', id: id, remoto: remoto, mesmo: !!(id && ((atual && atual.gist === id) || (bs.gist === id && Object.keys(bs.docs).length))) };
  }

  function desligar() {
    lsDel(K_CFG); // a base e o histórico ficam: se religar ao mesmo Gist, nada é somado duas vezes
    clearTimeout(timer);
    defEstado('desligado');
  }

  function resumo(docs) {
    var p = (docs && docs[CH]) || {};
    var q = 0; Object.keys(p.quiz || {}).forEach(function (k) { q += (p.quiz[k] && p.quiz[k].total) || 0; });
    return { xp: p.xp || 0, seq: p.sequencia || 0, cartoes: Object.keys(p.cartoes || {}).length, questoes: q, erros: Object.keys(p.erros || {}).length, licoes: Object.keys(p.licoes || {}).length };
  }
  function temProgresso(docs) { var r = resumo(docs); return r.xp > 0 || r.cartoes > 0 || r.questoes > 0 || r.licoes > 0; }

  function bytesB64(u8) {
    var s = '', n = u8.length;
    for (var i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64Bytes(b) {
    b = b.replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
    var s = atob(b), u = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  }
  async function viaStream(Ctor, formato, bytes) {
    var st = new Ctor(formato), w = st.writable.getWriter();
    w.write(bytes); w.close();
    return new Uint8Array(await new Response(st.readable).arrayBuffer());
  }
  function objetoBackup() { var l = lerLocal(); return { app: 'dojo-camara', v: 1, ts: Date.now(), docs: l.docs, at: l.at }; }
  async function codificar(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream !== 'undefined') {
      try { return 'DOJO1.' + bytesB64(await viaStream(CompressionStream, 'gzip', bytes)); } catch (e) { /* cai no texto simples */ }
    }
    return 'DOJO0.' + bytesB64(bytes);
  }
  async function decodificar(txt) {
    txt = String(txt || '').trim();
    var obj;
    if (txt.charAt(0) === '{') obj = JSON.parse(txt);
    else {
      txt = txt.replace(/\s+/g, '');
      var pre = txt.slice(0, 6), corpo = txt.slice(6), bytes;
      if (pre === 'DOJO1.') {
        if (typeof DecompressionStream === 'undefined') throw ErroSync('codigo', 'Este navegador não consegue abrir esse código.');
        bytes = await viaStream(DecompressionStream, 'gzip', b64Bytes(corpo));
      } else if (pre === 'DOJO0.') bytes = b64Bytes(corpo);
      else throw ErroSync('codigo', 'Código não reconhecido.');
      obj = JSON.parse(new TextDecoder().decode(bytes));
    }
    if (!ehObj(obj) || obj.app !== 'dojo-camara' || !ehObj(obj.docs)) throw ErroSync('codigo', 'Esse arquivo não é um backup do Dojô.');
    var docs = {};
    CHAVES.forEach(function (k) { if (obj.docs[k] !== undefined && obj.docs[k] !== null) docs[k] = obj.docs[k]; });
    return { docs: docs, at: ehObj(obj.at) ? obj.at : {}, ts: obj.ts || 0 };
  }

  function importar(backup, modo) {
    var local = lerLocal();
    guardarDesfazer(local.docs, modo === 'somar' ? 'importação somada' : 'importação substituindo');
    var novo;
    if (modo === 'somar') novo = mesclarDocs({ docs: {}, at: {} }, local, { docs: backup.docs, at: backup.at });
    else { var at = {}, agora = Date.now(); CHAVES.forEach(function (k) { at[k] = agora; }); novo = { docs: backup.docs, at: at }; }
    aplicarDocs(novo.docs, novo.at);
    S.app = true; congelado = true; // sempre recarrega depois de importar
    recarregar('Aplicando o backup…');
  }

  function desfazer() {
    var u = lerJSON(K_UNDO);
    if (!ehObj(u) || !ehObj(u.docs)) return false;
    var agora = Date.now(), at = {};
    CHAVES.forEach(function (k) { at[k] = agora; });
    aplicarDocs(u.docs, at);
    lsDel(K_UNDO);
    S.app = true; congelado = true;
    recarregar('Desfazendo a última atualização…');
    return true;
  }

  function linkConexao() {
    var c = lerCfg(); if (!c) return '';
    var o = bytesB64(new TextEncoder().encode(JSON.stringify({ t: c.token, g: c.gist })));
    return new URL('.', document.baseURI).href + '#sync=' + o;
  }
  function lerConexao(txt) {
    txt = String(txt || '').trim();
    var i = txt.indexOf('sync='); if (i >= 0) txt = txt.slice(i + 5);
    txt = txt.replace(/\s+/g, '');
    if (/^(ghp_|github_pat_|gho_|ghu_|ghs_)[A-Za-z0-9_]{16,}$/.test(txt)) return { t: txt, g: '' };
    try {
      var o = JSON.parse(new TextDecoder().decode(b64Bytes(txt)));
      if (o && typeof o.t === 'string' && o.t) return { t: o.t, g: typeof o.g === 'string' ? o.g : '' };
    } catch (e) { /* tenta como chave pura */ }
    if (/^[A-Za-z0-9_]{30,}$/.test(txt)) return { t: txt, g: '' };
    return null;
  }

  // ---------------------------------------------------------------- interface
  var painelAberto = false, raiz = null, acaoEmCurso = '', msgPainel = '', msgPainelTipo = '', importacao = null, mostrarColar = false;

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n).toLocaleString('pt-BR'); }
  function quando(ts) {
    if (!ts) return 'nunca';
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 45) return 'agora há pouco';
    if (s < 3600) return 'há ' + Math.round(s / 60) + ' min';
    if (s < 86400) return 'há ' + Math.round(s / 3600) + ' h';
    return 'há ' + Math.round(s / 86400) + ' dia(s)';
  }

  function css() {
    if (document.getElementById('dojo-sync-css')) return;
    var st = document.createElement('style'); st.id = 'dojo-sync-css';
    st.textContent = [
      '#dojo-sync-btn{position:relative}',
      '#dojo-sync-btn .dsync-ponto{position:absolute;right:7px;bottom:7px;width:10px;height:10px;border-radius:50%;border:2px solid var(--papel,#f6f1e7);background:#9a9186}',
      '#dojo-sync-btn[data-estado=ok] .dsync-ponto{background:#2f7a4a}',
      '#dojo-sync-btn[data-estado=sincronizando] .dsync-ponto{background:#d99a1d}',
      '#dojo-sync-btn[data-estado=offline] .dsync-ponto{background:#d99a1d}',
      '#dojo-sync-btn[data-estado=erro] .dsync-ponto{background:#b3261e}',
      '.dsync-fundo{position:fixed;inset:0;z-index:2147483000;background:rgba(20,15,10,.55);display:flex;align-items:center;justify-content:center;padding:12px}',
      '.dsync{background:var(--cartao,#fffdf8);color:var(--texto,#3a332b);border:1px solid var(--linha,#e3d9c7);border-radius:var(--r-lg,16px);box-shadow:var(--sombra-alta,0 14px 30px -14px rgba(28,24,20,.35));width:100%;max-width:580px;max-height:92vh;overflow:auto;padding:18px 18px 22px;font:16px/1.5 var(--sans,system-ui,sans-serif)}',
      '.dsync h2{font:700 21px/1.2 var(--serifa,Georgia,serif);color:var(--tinta,#1c1814);margin:0}',
      '.dsync h3{font:700 16px/1.3 var(--sans,system-ui,sans-serif);color:var(--tinta,#1c1814);margin:20px 0 6px}',
      '.dsync p,.dsync li{margin:6px 0}.dsync ol{padding-left:20px;margin:8px 0}',
      '.dsync a{color:var(--shu,#b5372a)}',
      '.dsync-topo{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px}',
      '.dsync-x{background:none;border:1px solid var(--linha,#e3d9c7);color:inherit;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer}',
      '.dsync-estado{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:var(--r-md,10px);background:var(--papel-2,#efe7d8)}',
      '.dsync-estado i{width:10px;height:10px;border-radius:50%;background:#9a9186;flex:none}',
      '.dsync-estado[data-estado=ok] i{background:#2f7a4a}.dsync-estado[data-estado=sincronizando] i,.dsync-estado[data-estado=offline] i{background:#d99a1d}.dsync-estado[data-estado=erro] i{background:#b3261e}',
      '.dsync-linha{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}',
      '.dsync input[type=password],.dsync input[type=text],.dsync textarea{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid var(--linha-forte,#cfc2ab);border-radius:var(--r-md,10px);background:var(--papel,#f6f1e7);color:inherit;font:inherit}',
      '.dsync textarea{min-height:90px;font:13px/1.4 ui-monospace,monospace}',
      '.dsync .botao{cursor:pointer;white-space:normal;max-width:100%;text-align:center}.dsync .botao[disabled]{opacity:.55;cursor:default}',
      '.dsync-msg{margin:10px 0;padding:10px 12px;border-radius:var(--r-md,10px);font-size:15px}',
      '.dsync-msg[data-tipo=ok]{background:var(--verde-fundo,#e5f1e7);color:var(--verde,#2f7a4a)}',
      '.dsync-msg[data-tipo=erro]{background:var(--erro-fundo,#f9e3df);color:var(--erro,#b3261e)}',
      '.dsync small,.dsync .suave{color:var(--suave,#6e6457);font-size:14px}',
      '.dsync-comp{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}',
      '.dsync-comp div{border:1px solid var(--linha,#e3d9c7);border-radius:var(--r-md,10px);padding:10px}',
      '.dsync-comp b{display:block;margin-bottom:4px}',
      '.dsync-sobre{position:fixed;inset:0;z-index:2147483100;background:var(--papel,#f6f1e7);color:var(--tinta,#1c1814);display:flex;align-items:center;justify-content:center;font:600 20px var(--serifa,Georgia,serif)}',
      '.dsync-aviso{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:2147483200;background:var(--noite,#1d1a16);color:var(--sobre-noite,#f6f1e7);padding:12px 16px;border-radius:12px;max-width:min(92vw,520px);box-shadow:0 8px 24px rgba(0,0,0,.35);font:15px/1.4 var(--sans,system-ui,sans-serif)}',
      '@media (max-width:560px){.dsync-fundo{align-items:flex-end;padding:0}.dsync{max-height:94vh;border-radius:16px 16px 0 0}.dsync-comp{grid-template-columns:1fr}}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function sobreposicao(txt) {
    css();
    var d = document.createElement('div'); d.className = 'dsync-sobre'; d.setAttribute('role', 'status'); d.textContent = txt;
    document.body.appendChild(d);
  }
  function aviso(txt) {
    css();
    var d = document.createElement('div'); d.className = 'dsync-aviso'; d.setAttribute('role', 'status'); d.textContent = txt;
    document.body.appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 6000);
  }

  function inserirBotao() {
    if (document.getElementById('dojo-sync-btn')) return;
    var st = document.querySelector('header.topo .status');
    if (!st) return;
    css();
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'icone'; b.id = 'dojo-sync-btn';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg><i class="dsync-ponto" aria-hidden="true"></i>';
    b.addEventListener('click', abrirPainel);
    var ref = st.querySelector('button.icone');
    st.insertBefore(b, ref || null);
    atualizarBotao();
  }
  function atualizarBotao() {
    var b = document.getElementById('dojo-sync-btn'); if (!b) return;
    var t = estado.tipo;
    b.setAttribute('data-estado', t);
    var txt = t === 'ok' ? 'Progresso sincronizado' : t === 'sincronizando' ? 'Sincronizando…' : t === 'offline' ? 'Sem conexão: sincroniza quando voltar' : t === 'erro' ? 'Erro na sincronização' : 'Sincronizar progresso entre aparelhos';
    b.setAttribute('aria-label', txt); b.title = txt;
  }

  function abrirPainel() {
    if (painelAberto) return;
    css();
    painelAberto = true; msgPainel = ''; importacao = null; mostrarColar = false;
    raiz = document.createElement('div'); raiz.className = 'dsync-fundo';
    raiz.addEventListener('click', function (ev) {
      if (ev.target === raiz) return fecharPainel();
      var a = ev.target.closest && ev.target.closest('[data-acao]');
      if (a && raiz.contains(a)) acao(a.getAttribute('data-acao'), a);
    });
    document.body.appendChild(raiz);
    document.addEventListener('keydown', tecla);
    renderPainel();
    var f = raiz.querySelector('input,button.botao'); if (f && f.focus) f.focus();
  }
  function tecla(ev) { if (ev.key === 'Escape') fecharPainel(); }
  function fecharPainel() {
    painelAberto = false;
    document.removeEventListener('keydown', tecla);
    if (raiz && raiz.parentNode) raiz.parentNode.removeChild(raiz);
    raiz = null;
  }
  function dlg(html) {
    return '<div class="dsync" role="dialog" aria-modal="true" aria-labelledby="dsync-t">' + html + '</div>';
  }
  function topo(titulo) {
    return '<div class="dsync-topo"><h2 id="dsync-t">' + titulo + '</h2><button type="button" class="dsync-x" data-acao="fechar" aria-label="Fechar">✕</button></div>';
  }
  function bloco(res) {
    return '<b>' + num(res.xp) + ' XP</b>' + num(res.cartoes) + ' cartões<br>' + num(res.questoes) + ' questões respondidas<br>' + num(res.erros) + ' no caderno de erros<br>sequência: ' + num(res.seq) + ' dia(s)';
  }

  function renderPainel() {
    if (!raiz) return;
    var cfg = lerCfg(), h = '';
    var dl0 = raiz.querySelector('.dsync'), rolagem = dl0 ? dl0.scrollTop : 0;
    var foco = raiz.querySelector('input:focus,textarea:focus'), idFoco = foco && foco.id, valFoco = foco && foco.value;
    var tokenDigitado = (raiz.querySelector('#dsync-token') || {}).value || '', colado = (raiz.querySelector('#dsync-colado') || {}).value || '', cod = (raiz.querySelector('#dsync-codigo') || {}).value || '';
    var ocupado = acaoEmCurso ? ' disabled' : '';
    h += topo('Sincronizar progresso');
    if (importacao) {
      var ag = resumo(lerLocal().docs);
      h += '<p>Esse backup foi gerado ' + (importacao.ts ? 'em ' + new Date(importacao.ts).toLocaleString('pt-BR') : 'em data desconhecida') + '. Compare antes de aplicar:</p>' +
        '<div class="dsync-comp"><div><b>Neste aparelho</b>' + bloco(ag) + '</div><div><b>No backup</b>' + bloco(resumo(importacao.docs)) + '</div></div>' +
        '<div class="dsync-linha"><button type="button" class="botao botao--primario" data-acao="imp-subst">Substituir o que há aqui pelo backup</button>' +
        '<button type="button" class="botao botao--secundario" data-acao="imp-somar">Somar ao que há aqui</button>' +
        '<button type="button" class="botao botao--secundario" data-acao="imp-cancelar">Cancelar</button></div>' +
        '<p class="suave">“Substituir” é o certo quando o backup é mais novo que este aparelho. “Somar” junta os dois históricos (XP e contadores são somados): use só se cada um tem estudos diferentes. Dá para desfazer logo depois.</p>';
      raiz.innerHTML = dlg(h); return;
    }
    // estado da nuvem
    if (!cfg) {
      h += '<p>Hoje o progresso (XP, sequência, cartões, questões, erros, notas das provas, rascunhos da discursiva) fica só <b>neste aparelho</b>. Ligue a sincronização para o PC e o celular usarem o mesmo.</p>' +
        '<h3>1. Crie uma chave no GitHub (uma vez só)</h3>' +
        '<ol><li><a href="' + URL_TOKEN + '" target="_blank" rel="noopener">Abrir a página de criar chave</a> (entre na sua conta, se pedir).</li>' +
        '<li>Em <b>Expiration</b>, escolha <b>No expiration</b>. A permissão <b>gist</b> já vem marcada; não marque mais nada.</li>' +
        '<li>Clique em <b>Generate token</b> e copie o código que começa com <code>ghp_</code>.</li></ol>' +
        '<h3>2. Cole a chave aqui</h3>' +
        '<input type="password" id="dsync-token" placeholder="ghp_…" autocomplete="off" autocapitalize="off" spellcheck="false">' +
        '<div class="dsync-linha"><button type="button" class="botao botao--primario" data-acao="ligar"' + ocupado + '>' + (acaoEmCurso === 'ligar' ? 'Ligando…' : 'Ligar a sincronização') + '</button></div>' +
        '<p class="suave">A chave só guarda uma cópia <b>secreta</b> do progresso num Gist da sua conta e fica salva apenas neste aparelho. Se os dois lados já tiverem progresso, eu pergunto o que fazer antes de juntar.</p>' +
        '<h3>Já ligou em outro aparelho?</h3>' +
        '<p>Cole aqui o link ou o código que o outro aparelho gerou em “Copiar link para outro aparelho”.</p>' +
        '<input type="text" id="dsync-colado" placeholder="Link ou código" autocomplete="off" spellcheck="false">' +
        '<div class="dsync-linha"><button type="button" class="botao botao--secundario" data-acao="conectar"' + ocupado + '>Conectar este aparelho</button></div>';
    } else {
      var tipo = estado.tipo === 'desligado' ? (lerMeta().ultimoSync ? 'ok' : 'sincronizando') : estado.tipo;
      var texto = tipo === 'ok' ? 'Sincronizado ' + quando(lerMeta().ultimoSync) : tipo === 'sincronizando' ? 'Sincronizando…' : (estado.msg || 'Aguardando');
      h += '<div class="dsync-estado" data-estado="' + tipo + '" role="status"><i></i><span>' + esc(texto) + '</span></div>' +
        '<p class="suave">Sincroniza sozinho ao abrir o app, depois de alguns segundos de estudo e ao sair. Se você estudar nos dois aparelhos antes de sincronizar, o app junta tudo sem perder nada.</p>' +
        '<div class="dsync-linha"><button type="button" class="botao botao--primario" data-acao="agora"' + ocupado + '>Sincronizar agora</button>' +
        '<button type="button" class="botao botao--secundario" data-acao="link">Copiar link para outro aparelho</button>' +
        '<button type="button" class="botao botao--secundario" data-acao="desligar">Desligar neste aparelho</button></div>' +
        '<p class="suave">O link contém a chave do GitHub: mande só para você mesmo (ex.: WhatsApp “Você”) e apague a mensagem depois.</p>';
    }
    if (msgPainel) h += '<div class="dsync-msg" data-tipo="' + msgPainelTipo + '" role="status">' + esc(msgPainel) + '</div>';
    // backup manual
    h += '<h3>Backup manual</h3><p>Para guardar uma cópia ou levar o progresso sem internet.</p>' +
      '<div class="dsync-linha"><button type="button" class="botao botao--secundario" data-acao="baixar">Baixar arquivo</button>' +
      '<button type="button" class="botao botao--secundario" data-acao="copiar-codigo">Copiar código</button>' +
      '<button type="button" class="botao botao--secundario" data-acao="abrir-arquivo">Importar arquivo</button>' +
      '<button type="button" class="botao botao--secundario" data-acao="colar-codigo">Colar código</button></div>' +
      '<input type="file" id="dsync-arq" accept=".json,application/json,text/plain" hidden>';
    if (mostrarColar) h += '<textarea id="dsync-codigo" placeholder="Cole aqui o código (começa com DOJO1. ou DOJO0.)" spellcheck="false"></textarea><div class="dsync-linha"><button type="button" class="botao botao--primario" data-acao="importar-codigo">Importar</button></div>';
    var u = lerJSON(K_UNDO);
    if (ehObj(u) && ehObj(u.docs)) h += '<h3>Arrependeu?</h3><div class="dsync-linha"><button type="button" class="botao botao--secundario" data-acao="desfazer">Desfazer a última atualização (' + esc(u.motivo || '') + ', ' + quando(u.ts) + ')</button></div>';
    raiz.innerHTML = dlg(h);
    var arq = raiz.querySelector('#dsync-arq');
    if (arq) arq.addEventListener('change', function () { if (arq.files && arq.files[0]) lerArquivo(arq.files[0]); });
    var t2 = raiz.querySelector('#dsync-token'); if (t2) t2.value = tokenDigitado;
    var c2 = raiz.querySelector('#dsync-colado'); if (c2) c2.value = colado;
    var k2 = raiz.querySelector('#dsync-codigo'); if (k2) k2.value = cod;
    var dl1 = raiz.querySelector('.dsync'); if (dl1) dl1.scrollTop = rolagem;
    if (idFoco) { var e = raiz.querySelector('#' + idFoco); if (e) { e.focus(); try { e.setSelectionRange(valFoco.length, valFoco.length); } catch (x) { /* nada */ } } }
  }

  function msg(texto, tipo) { msgPainel = texto; msgPainelTipo = tipo || 'ok'; renderPainel(); }

  async function copiar(txt) {
    try { await navigator.clipboard.writeText(txt); return true; } catch (e) { /* tenta o método antigo */ }
    try {
      var t = document.createElement('textarea'); t.value = txt; t.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(t); t.select(); var ok = document.execCommand('copy'); document.body.removeChild(t); return ok;
    } catch (e) { return false; }
  }
  async function lerArquivo(f) {
    try { importacao = await decodificar(await f.text()); renderPainel(); }
    catch (e) { msg(e.codigo === 'codigo' ? e.message : 'Não consegui ler esse arquivo.', 'erro'); }
  }

  async function acao(nome) {
    try {
      if (nome === 'fechar') return fecharPainel();
      if (nome === 'ligar') {
        var tk = (raiz.querySelector('#dsync-token') || {}).value || '';
        if (!tk.trim()) return msg('Cole a chave do GitHub primeiro.', 'erro');
        var oo = lerConexao(tk);
        if (!oo) return msg('Essa chave não parece válida. Ela começa com ghp_ e não tem espaços.', 'erro');
        fecharPainel(); return perguntarConexao(oo);
      }
      if (nome === 'conectar') {
        var o = lerConexao((raiz.querySelector('#dsync-colado') || {}).value);
        if (!o) return msg('Não reconheci esse link/código. Copie de novo em “Copiar link para outro aparelho”.', 'erro');
        fecharPainel(); return perguntarConexao(o);
      }
      if (nome === 'agora') { var rr = await sincronizar(); if (rr && rr.erro) msg(msgErro(rr.erro), 'erro'); else if (!(rr && rr.mudouLocal)) msg('Tudo sincronizado.', 'ok'); return; }
      if (nome === 'link') { var ok = await copiar(linkConexao()); return msg(ok ? 'Link copiado. Abra-o no celular.' : 'Não consegui copiar automaticamente.', ok ? 'ok' : 'erro'); }
      if (nome === 'desligar') { if (confirm('Desligar a sincronização neste aparelho? O progresso daqui continua guardado e o que está na nuvem não é apagado.')) { desligar(); msg('Sincronização desligada neste aparelho.', 'ok'); } return; }
      if (nome === 'baixar') {
        var blob = new Blob([JSON.stringify(objetoBackup())], { type: 'application/json' });
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        var d = new Date(), p2 = function (n) { return String(n).padStart(2, '0'); };
        a.download = 'dojo-progresso-' + d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        return msg('Arquivo baixado.', 'ok');
      }
      if (nome === 'copiar-codigo') { var okc = await copiar(await codificar(objetoBackup())); return msg(okc ? 'Código copiado. Cole em “Colar código” no outro aparelho.' : 'Não consegui copiar automaticamente.', okc ? 'ok' : 'erro'); }
      if (nome === 'abrir-arquivo') { var f = raiz.querySelector('#dsync-arq'); if (f) f.click(); return; }
      if (nome === 'colar-codigo') { mostrarColar = !mostrarColar; renderPainel(); var k = raiz.querySelector('#dsync-codigo'); if (k) k.focus(); return; }
      if (nome === 'importar-codigo') {
        try { importacao = await decodificar((raiz.querySelector('#dsync-codigo') || {}).value); renderPainel(); }
        catch (e) { msg(e.codigo === 'codigo' ? e.message : 'Esse código parece estar incompleto ou corrompido.', 'erro'); }
        return;
      }
      if (nome === 'imp-cancelar') { importacao = null; return renderPainel(); }
      if (nome === 'imp-subst' || nome === 'imp-somar') { var bk = importacao; importacao = null; fecharPainel(); return importar(bk, nome === 'imp-somar' ? 'somar' : 'substituir'); }
      if (nome === 'desfazer') { if (confirm('Voltar ao progresso que este aparelho tinha antes da última atualização?')) desfazer(); return; }
    } catch (e) { acaoEmCurso = ''; msg(msgErro(e), 'erro'); }
  }

  // Confirmação ÚNICA para qualquer forma de conectar (chave colada, link ou código): mostra a conta do GitHub
  // (evita que um link de terceiros mande o seu progresso para outra conta) e pergunta o que fazer se os dois lados têm progresso.
  async function perguntarConexao(o) {
    css();
    var fundo = document.createElement('div'); fundo.className = 'dsync-fundo';
    fundo.innerHTML = dlg(topo('Conectar este aparelho') + '<p id="dsync-corpo">Verificando a chave no GitHub…</p><div id="dsync-res"></div>');
    document.body.appendChild(fundo);
    var corpo = fundo.querySelector('#dsync-corpo'), res = fundo.querySelector('#dsync-res'), insp = null, modo = 'somar';
    fundo.addEventListener('click', async function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-x],[data-acao]');
      if (ev.target === fundo || (b && (b.getAttribute('data-x') === 'nao' || b.getAttribute('data-acao') === 'fechar'))) { fundo.remove(); return; }
      if (!b || b.getAttribute('data-x') !== 'ok' || !insp) return;
      var r = fundo.querySelector('input[name=dsync-modo]:checked'); if (r) modo = r.value;
      b.disabled = true; b.textContent = 'Conectando…'; res.innerHTML = '';
      try {
        var rs = await ligar(insp.token, insp.id, modo, insp.mesmo);
        fundo.remove();
        if (!rs.recarrega) aviso('Conectado! Este aparelho já está sincronizado.');
      } catch (e) { b.disabled = false; b.textContent = 'Conectar'; res.innerHTML = '<div class="dsync-msg" data-tipo="erro">' + esc(msgErro(e)) + '</div>'; }
    });
    try { insp = await inspecionar(o); }
    catch (e) {
      corpo.outerHTML = '<div class="dsync-msg" data-tipo="erro">' + esc(msgErro(e)) + '</div><div class="dsync-linha"><button type="button" class="botao botao--secundario" data-x="nao">Fechar</button></div>';
      return;
    }
    var local = lerLocal().docs, temLocal = temProgresso(local), temRemoto = !!(insp.remoto && temProgresso(insp.remoto.docs));
    var h = '<p>Conta do GitHub: <b>' + esc(insp.login || 'desconhecida') + '</b>. Só continue se for a sua.</p>';
    if (insp.mesmo) h += '<p>Este aparelho já estava ligado a essa mesma cópia; vou só reconectar.</p>';
    else if (!insp.id) h += '<p>Ainda não existe cópia na nuvem: vou criar uma (secreta) e enviar o progresso deste aparelho.</p>';
    else if (temRemoto && temLocal) {
      h += '<p>Os dois lados já têm progresso. Compare:</p><div class="dsync-comp"><div><b>Neste aparelho</b>' + bloco(resumo(local)) + '</div><div><b>Na nuvem</b>' + bloco(resumo(insp.remoto.docs)) + '</div></div>' +
        '<label style="display:block;margin:6px 0"><input type="radio" name="dsync-modo" value="somar" checked> <b>Somar</b> os dois (cada aparelho teve estudos diferentes — é o caso de quem usou PC e celular separados até agora)</label>' +
        '<label style="display:block;margin:6px 0"><input type="radio" name="dsync-modo" value="nuvem"> <b>Usar só o da nuvem</b> e descartar o daqui (o daqui é uma cópia mais antiga do mesmo progresso). Dá para desfazer.</label>';
    } else if (temRemoto) h += '<p>Na nuvem há progresso (' + num(resumo(insp.remoto.docs).xp) + ' XP): vou trazê-lo para cá.</p>';
    else h += '<p>Vou enviar o progresso deste aparelho para a nuvem.</p>';
    h += '<div class="dsync-linha"><button type="button" class="botao botao--primario" data-x="ok">Conectar</button><button type="button" class="botao botao--secundario" data-x="nao">Agora não</button></div>';
    corpo.outerHTML = h;
  }

  // ---------------------------------------------------------------- partida
  function jaConectado(o) { var c = lerCfg(); return !!(c && o && c.token === limparToken(o.t) && (!o.g || o.g === c.gist)); }

  function lerHashConexao() {
    var h = location.hash || '';
    if (h.indexOf('#sync=') !== 0) return null;
    var o = lerConexao(h.slice(1));
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* nada */ }
    return o;
  }

  function iniciar() {
    var conexao = lerHashConexao();
    if (lerCfg() && !conexao && navigator.onLine !== false) sincronizar({ inicial: true });
    else resolverPronto();
    function pronto() {
      css();
      inserirBotao();
      var pend = false;
      new MutationObserver(function () { if (pend) return; pend = true; requestAnimationFrame(function () { pend = false; inserirBotao(); }); })
        .observe(document.documentElement, { childList: true, subtree: true });
      if (conexao) { if (jaConectado(conexao)) aviso('Este aparelho já está conectado.'); else perguntarConexao(conexao); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pronto); else pronto();

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { if (lerCfg()) sincronizar(); }
      else {
        if (recarregarAoVoltar) { recarregarAoVoltar = false; recarregar(); return; }
        if (lerCfg() && Date.now() - ultimaTentativa > 45000) sincronizar();
      }
    });
    window.addEventListener('hashchange', function () { var o = lerHashConexao(); if (!o) return; if (jaConectado(o)) aviso('Este aparelho já está conectado.'); else perguntarConexao(o); }); // link aberto numa aba que já estava aberta
    window.addEventListener('online', function () { if (lerCfg()) sincronizar(); });
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* nada */ }
    if (lerCfg() && !emCurso) defEstado(lerMeta().ultimoSync ? 'ok' : 'sincronizando');
  }

  window.__dojoSync = S;
  S.abrir = abrirPainel;
  S.sincronizar = sincronizar;
  S.estado = function () { return estado; };
  S._t = { mesclarDocs: mesclarDocs, mesclarValor: mesclarValor, iguais: iguais, codificar: codificar, decodificar: decodificar, lerConexao: lerConexao, linkConexao: linkConexao, CHAVES: CHAVES };
  iniciar();
})();
