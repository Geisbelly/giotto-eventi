// API das visitas: Cloudflare Worker + D1 (plano gratuito).
// GET  /visitas            -> lista pública de visitas
// GET  /verificar          -> 204 se a chave (header X-Chave) estiver certa
// PUT  /visitas/:local_id  -> grava a visita (sem chave)
// GET  /dados/:colecao     -> locais e fornecedores são públicos; eventos e confirmacoes exigem X-Chave (?evento=id filtra)
// PUT  /dados/:colecao/:id -> locais e fornecedores sem chave (excluir exige X-Chave); eventos só com X-Chave;
//                             confirmacoes sem chave só para um evento que existe, sem excluir nem trocar de evento
// GET  /convite/:evento    -> só o que o convidado vê (?c=id do convidado traz o nome e os lugares dele)

const MAX_BYTES = 20_000;
const MAX_BYTES_DADOS = 300_000;
const MAX_HTML = 200_000; // campos *_html (modelo de convite feito pelo organizador)
// ler/gravar: 'livre' = sem chave; 'chave' = exige X-Chave. Excluir (removido: true) sempre exige a chave.
// Eventos têm dados pessoais (contato, convidados, idades, orçamento): só quem tem a chave lê ou grava.
// confirmacoes = respostas dos convidados. O convidado grava sem chave pelo convite; a lista só sai com a chave.
const COLECOES = {
  locais: { ler: 'livre', gravar: 'livre' },
  fornecedores: { ler: 'livre', gravar: 'livre' },
  eventos: { ler: 'chave', gravar: 'chave' },
  confirmacoes: { ler: 'chave', gravar: 'livre' },
};
const RE_ID = /^[a-z0-9-]{1,80}$/;

async function registro(env, col, id) {
  const r = await env.DB.prepare('SELECT dados FROM registros WHERE colecao = ?1 AND id = ?2').bind(col, id).first();
  return r ? JSON.parse(r.dados) : null;
}

// O que o convite mostra. Nada de contato, lista de convidados, orçamento, gastos ou escolhas.
function eventoPublico(ev, convId) {
  const conv = (Array.isArray(ev.convidados) ? ev.convidados : []).find((c) => c && c.id === convId);
  const convite = { ...(ev.convite && typeof ev.convite === 'object' ? ev.convite : {}) };
  if ((Array.isArray(ev.itens_festa) ? ev.itens_festa : []).some((i) => i && i.sexo)) convite.pedir_sexo = true;
  return {
    id: ev.id, nome: ev.nome || '', data: ev.data || '', hora_inicio: ev.hora_inicio || '', hora_fim: ev.hora_fim || '',
    tema: ev.tema || '', organiza: ev.organiza || '', convite,
    presentes: (Array.isArray(ev.presentes) ? ev.presentes : []).filter((g) => g && g.nome)
      .map((g) => ({ id: g.id, nome: g.nome, link: g.link || '' })),
    convidados: conv ? [{ id: conv.id, nome: conv.nome || '', lugares: conv.lugares ?? null }] : [],
  };
}
const CRITERIOS = ['preco', 'estrutura', 'localizacao', 'atendimento', 'ambiente', 'qualidade', 'confianca', 'flexibilidade'];

function cors(env, req) {
  const origem = req.headers.get('Origin') || '';
  const permitidas = (env.ORIGENS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = permitidas.includes(origem) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem);
  return {
    'Access-Control-Allow-Origin': ok ? origem : permitidas[0] || '',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Chave',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(dados, status, headers) {
  return new Response(dados == null ? null : JSON.stringify(dados), {
    status, headers: { ...headers, ...(dados == null ? {} : { 'Content-Type': 'application/json; charset=utf-8' }) },
  });
}

async function chaveOk(req, env) {
  const recebida = req.headers.get('X-Chave') || '';
  if (!env.CHAVE_EDICAO || !recebida) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(recebida)),
    crypto.subtle.digest('SHA-256', enc.encode(env.CHAVE_EDICAO)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// Data da gravação: aceita a do aparelho, mas nunca no futuro (senão travaria as edições seguintes).
function quando(v) {
  const agora = Date.now();
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return new Date(isNaN(t) || t > agora ? agora : t).toISOString();
}

function limpar(d) {
  const txt = (v, n) => String(v ?? '').slice(0, n);
  const lista = (v) => (Array.isArray(v) ? v.slice(0, 50).map((x) => txt(x, 300)) : []);
  const nota = (v) => Math.max(0, Math.min(5, Math.round(Number(v) || 0)));
  const crit = {};
  for (const k of CRITERIOS) crit[k] = nota(d?.criterios?.[k]);
  return {
    status: ['', 'quero', 'visitado', 'descartado'].includes(d?.status) ? d.status : '',
    favorito: !!d?.favorito,
    data: /^\d{4}-\d{2}-\d{2}$/.test(d?.data || '') ? d.data : '',
    nota: nota(d?.nota),
    criterios: crit,
    pros: lista(d?.pros),
    contras: lista(d?.contras),
    anotacoes: txt(d?.anotacoes, 5000),
    orcamento_valor: txt(d?.orcamento_valor, 60),
    orcamento_condicao: txt(d?.orcamento_condicao, 300),
    album: /^https?:\/\//.test(d?.album || '') ? txt(d.album, 500) : '',
  };
}

// Catálogo e eventos: o site define os campos; aqui só limita tamanho e formato.
// Tudo é exibido escapado no site, e links passam por verificação de http(s) lá.
function limparGenerico(v, nivel = 0) {
  if (v == null) return null;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v.slice(0, 5000);
  if (nivel >= 5) return null;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => limparGenerico(x, nivel + 1));
  if (typeof v === 'object') {
    const o = {};
    let n = 0;
    for (const [k, x] of Object.entries(v)) {
      if (!/^[a-z0-9_]{1,40}$/i.test(k) || n++ >= 80) continue;
      o[k] = typeof x === 'string' && k.endsWith('_html') ? x.slice(0, MAX_HTML) : limparGenerico(x, nivel + 1);
    }
    return o;
  }
  return null;
}

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    const url = new URL(req.url);
    const partes = url.pathname.split('/').filter(Boolean);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    if (req.method === 'GET' && partes[0] === 'visitas' && partes.length === 1) {
      const { results } = await env.DB.prepare('SELECT local_id, dados, atualizado_em FROM visitas').all();
      return json(results.map((r) => ({ ...r, dados: JSON.parse(r.dados) })), 200, { ...h, 'Cache-Control': 'no-store' });
    }

    if (req.method === 'GET' && partes[0] === 'verificar') {
      return json(null, (await chaveOk(req, env)) ? 204 : 401, h);
    }

    if (req.method === 'PUT' && partes[0] === 'visitas' && partes.length === 2) {
      const id = decodeURIComponent(partes[1]);
      if (!/^[a-z0-9-]{1,80}$/.test(id)) return json({ erro: 'id inválido' }, 400, h);
      const corpo = await req.text();
      if (corpo.length > MAX_BYTES) return json({ erro: 'muito grande' }, 413, h);
      let dados;
      try { dados = JSON.parse(corpo); } catch { return json({ erro: 'json inválido' }, 400, h); }
      const em = quando(dados.atualizado_em);
      await env.DB.prepare(
        `INSERT INTO visitas (local_id, dados, atualizado_em) VALUES (?1, ?2, ?3)
         ON CONFLICT(local_id) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em
         WHERE excluded.atualizado_em >= visitas.atualizado_em`,
      ).bind(id, JSON.stringify(limpar(dados)), em).run();
      return json({ ok: true }, 200, h);
    }

    if (req.method === 'GET' && partes[0] === 'convite' && partes.length === 2) {
      const id = decodeURIComponent(partes[1]);
      if (!RE_ID.test(id)) return json({ erro: 'id inválido' }, 400, h);
      const ev = await registro(env, 'eventos', id);
      if (!ev || ev.removido) return json({ erro: 'não encontrado' }, 404, h);
      // Presentes já reservados: só qual presente e o id da resposta, sem nome de quem reservou.
      const { results } = await env.DB.prepare(
        "SELECT id, dados FROM registros WHERE colecao = 'confirmacoes' AND json_extract(dados, '$.evento') = ?1",
      ).bind(id).all();
      const reservas = results.map((r) => ({ id: r.id, d: JSON.parse(r.dados) }))
        .filter((r) => r.d.presente && r.d.resposta !== 'nao' && !r.d.removido)
        .map((r) => ({ id: r.id, presente: r.d.presente }));
      return json({ evento: eventoPublico({ ...ev, id }, url.searchParams.get('c') || ''), reservas }, 200, { ...h, 'Cache-Control': 'no-store' });
    }

    if (partes[0] === 'dados' && COLECOES[partes[1]]) {
      const col = partes[1];
      if (req.method === 'GET' && partes.length === 2) {
        if (COLECOES[col].ler !== 'livre' && !(await chaveOk(req, env))) return json({ erro: 'chave inválida' }, 401, h);
        const ev = url.searchParams.get('evento');
        const { results } = ev && RE_ID.test(ev)
          ? await env.DB.prepare("SELECT id, dados, atualizado_em FROM registros WHERE colecao = ?1 AND json_extract(dados, '$.evento') = ?2").bind(col, ev).all()
          : await env.DB.prepare('SELECT id, dados, atualizado_em FROM registros WHERE colecao = ?1').bind(col).all();
        return json(results.map((r) => ({ ...r, dados: JSON.parse(r.dados) })), 200, { ...h, 'Cache-Control': 'no-store' });
      }
      if (req.method === 'PUT' && partes.length === 3) {
        const id = decodeURIComponent(partes[2]);
        if (!/^[a-z0-9-]{1,80}$/.test(id)) return json({ erro: 'id inválido' }, 400, h);
        const corpo = await req.text();
        if (corpo.length > MAX_BYTES_DADOS) return json({ erro: 'muito grande' }, 413, h);
        let dados;
        try { dados = JSON.parse(corpo); } catch { return json({ erro: 'json inválido' }, 400, h); }
        if (!dados || typeof dados !== 'object' || Array.isArray(dados)) return json({ erro: 'formato inválido' }, 400, h);
        const temChave = await chaveOk(req, env);
        if ((COLECOES[col].gravar !== 'livre' || dados.removido === true) && !temChave) return json({ erro: 'chave inválida' }, 401, h);
        if (col === 'confirmacoes' && !temChave) {
          // Convidado: a resposta precisa ser de um evento que existe e não pode mudar de evento.
          const evId = String(dados.evento || '');
          const ev = RE_ID.test(evId) ? await registro(env, 'eventos', evId) : null;
          if (!ev || ev.removido) return json({ erro: 'evento não encontrado' }, 404, h);
          const antes = await registro(env, 'confirmacoes', id);
          if (antes && (antes.evento !== evId || antes.removido)) return json({ erro: 'resposta de outro evento' }, 409, h);
        }
        const em = quando(dados.atualizado_em);
        const limpo = { ...limparGenerico(dados), id, removido: dados.removido === true };
        await env.DB.prepare(
          `INSERT INTO registros (colecao, id, dados, atualizado_em) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(colecao, id) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em
           WHERE excluded.atualizado_em >= registros.atualizado_em`,
        ).bind(col, id, JSON.stringify(limpo), em).run();
        return json({ ok: true, item: limpo, atualizado_em: em }, 200, h);
      }
    }

    return json({ erro: 'não encontrado' }, 404, h);
  },
};
