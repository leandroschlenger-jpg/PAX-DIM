/* ═══════════════════════════════════════════════════════════════════
   PAX Financeiro — Proxy Pluggy (Open Finance)
   ───────────────────────────────────────────────────────────────────
   Roda como Netlify Function. As credenciais da Pluggy NUNCA saem
   daqui — o app cliente só conversa com esta função.

   Variáveis de ambiente necessárias (Netlify → Site settings →
   Environment variables):
     PLUGGY_CLIENT_ID      — Client ID do Dashboard Pluggy
     PLUGGY_CLIENT_SECRET  — Client Secret do Dashboard Pluggy
     PAX_ACCESS_TOKEN      — senha que o app envia p/ usar a função

   Ações (POST, body JSON):
     { action:'cartoes' }
       → lista as contas de cartão de crédito conectadas
     { action:'fatura', accountId:'…', mes:'2026-08' }
       → devolve as transações da fatura daquele mês
   ═══════════════════════════════════════════════════════════════════ */

const API = 'https://api.pluggy.ai';

/* ── Mapa de categorias Pluggy → categorias do PAX ── */
const CAT_MAP = {
  'Food and drinks': 'Alimentacao',
  'Supermarket': 'Alimentacao',
  'Restaurants': 'Alimentacao',
  'Groceries': 'Alimentacao',
  'Delivery': 'Alimentacao',
  'Shopping': 'Compras',
  'Online shopping': 'Compras',
  'Clothing': 'Compras',
  'Electronics': 'Tecnologia',
  'Technology': 'Tecnologia',
  'Software': 'Tecnologia',
  'Digital services': 'Assinaturas',
  'Streaming': 'Assinaturas',
  'Subscriptions': 'Assinaturas',
  'Healthcare': 'Saude',
  'Pharmacy': 'Saude',
  'Health': 'Saude',
  'Education': 'Educacao',
  'Transport': 'Veiculo',
  'Gas station': 'Veiculo',
  'Automotive': 'Veiculo',
  'Taxi and ride-hailing': 'Veiculo',
  'Leisure': 'Lazer',
  'Entertainment': 'Lazer',
  'Travel': 'Viagem',
  'Airlines': 'Viagem',
  'Accommodation': 'Viagem',
  'Housing': 'Moradia',
  'Utilities': 'Moradia',
  'Telecommunications': 'Servicos',
  'Services': 'Servicos',
  'Insurance': 'Servicos',
  'Taxes': 'Impostos',
  'Pets': 'Familia',
  'Kids': 'Familia',
  'Personal care': 'Pessoal',
  'Gyms and fitness': 'Pessoal'
};

function mapCat(pluggyCat) {
  if (!pluggyCat) return 'Outros';
  if (CAT_MAP[pluggyCat]) return CAT_MAP[pluggyCat];
  // tenta casar por palavra-chave
  const c = String(pluggyCat).toLowerCase();
  if (/food|restaur|market|grocer|deliver/.test(c)) return 'Alimentacao';
  if (/shop|cloth|retail/.test(c))                  return 'Compras';
  if (/electro|tech|software|app/.test(c))          return 'Tecnologia';
  if (/stream|subscri|digital/.test(c))             return 'Assinaturas';
  if (/health|pharm|medic|dent/.test(c))            return 'Saude';
  if (/educ|school|course/.test(c))                 return 'Educacao';
  if (/transp|gas|fuel|auto|taxi|uber/.test(c))     return 'Veiculo';
  if (/leisur|entertain|cinema|game/.test(c))       return 'Lazer';
  if (/travel|airline|hotel|accom/.test(c))         return 'Viagem';
  if (/hous|rent|utilit|electric|water/.test(c))    return 'Moradia';
  if (/telecom|phone|internet|servic|insur/.test(c))return 'Servicos';
  if (/tax|fee/.test(c))                            return 'Impostos';
  if (/pet|kid|child|family/.test(c))               return 'Familia';
  if (/personal|beauty|gym|fitness/.test(c))        return 'Pessoal';
  return 'Outros';
}

/* ── Autentica na Pluggy e devolve a API Key (válida 2h) ── */
async function getApiKey() {
  const clientId     = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('CONFIG: PLUGGY_CLIENT_ID/SECRET nao configurados no Netlify');
  }
  const r = await fetch(API + '/auth', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ clientId, clientSecret })
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('AUTH: Pluggy recusou as credenciais (' + r.status + ') ' + t.slice(0, 200));
  }
  const j = await r.json();
  if (!j.apiKey) throw new Error('AUTH: resposta sem apiKey');
  return j.apiKey;
}

async function pget(path, apiKey) {
  const r = await fetch(API + path, { headers: { 'X-API-KEY': apiKey } });
  if (!r.ok) {
    const t = await r.text();
    throw new Error('API ' + path.split('?')[0] + ' (' + r.status + '): ' + t.slice(0, 200));
  }
  return r.json();
}

/* ── Lista todas as contas de cartão de crédito conectadas ── */
async function listarCartoes(apiKey) {
  const items = await pget('/items', apiKey);
  const lista = items.results || items.items || [];
  const out = [];
  for (const it of lista) {
    let accs;
    try {
      accs = await pget('/accounts?itemId=' + encodeURIComponent(it.id), apiKey);
    } catch (e) { continue; }
    for (const a of (accs.results || [])) {
      if (a.type === 'CREDIT' || a.subtype === 'CREDIT_CARD') {
        out.push({
          accountId:  a.id,
          itemId:     it.id,
          banco:      (it.connector && it.connector.name) || 'Banco',
          nome:       a.name || a.marketingName || 'Cartao',
          numero:     a.number || '',
          bandeira:   (a.creditData && a.creditData.brand) || '',
          limite:     (a.creditData && a.creditData.creditLimit) || null,
          vencimento: (a.creditData && a.creditData.balanceDueDate) || null,
          status:     it.status || ''
        });
      }
    }
  }
  return out;
}

/* ── Busca as transações da fatura de um mês ──
   Estratégia: puxa uma janela ampla e prioriza billForecastDate
   (campo que o Open Finance devolve com o mês da fatura).          */
async function buscarFatura(apiKey, accountId, mes) {
  const [ano, m] = mes.split('-').map(Number);
  // Janela: 75 dias antes do início do mês até o fim do mês
  const ini = new Date(Date.UTC(ano, m - 1, 1));
  ini.setUTCDate(ini.getUTCDate() - 75);
  const fim = new Date(Date.UTC(ano, m, 0));
  const fmt = d => d.toISOString().slice(0, 10);

  let todas = [], url = '/v2/transactions?accountId=' + encodeURIComponent(accountId) +
    '&dateFrom=' + fmt(ini) + '&dateTo=' + fmt(fim), guard = 0;

  while (url && guard++ < 20) {
    const page = await pget(url, apiKey);
    todas = todas.concat(page.results || []);
    url = page.next ? '/v2/transactions' + page.next : null;
  }

  // Só compras (DEBIT). Pagamentos da fatura (CREDIT) não são itens.
  const compras = todas.filter(t => t.type === 'DEBIT');

  // Se a instituição informa o mês da fatura, usa isso — é o mais correto
  const comForecast = compras.filter(
    t => t.creditCardMetadata && t.creditCardMetadata.billForecastDate === mes
  );
  const sel = comForecast.length > 0
    ? comForecast
    : compras.filter(t => String(t.date).slice(0, 7) === mes);

  return sel.map(t => {
    const cc  = t.creditCardMetadata || {};
    const parc = (cc.installmentNumber && cc.totalInstallments && cc.totalInstallments > 1)
      ? ' ' + cc.installmentNumber + '/' + cc.totalInstallments
      : '';
    const nome = (t.merchant && t.merchant.name) || t.description || 'Compra';
    return {
      extId:     t.id,
      descricao: (nome + parc).slice(0, 80),
      valor:     Math.round(Math.abs(t.amount) * 100) / 100,
      data:      String(cc.purchaseDate || t.date).slice(0, 10),
      categoria: mapCat(t.category),
      status:    t.status === 'POSTED' ? 'OK' : '',
      parcela:   parc.trim() || null,
      catOrig:   t.category || null
    };
  }).sort((a, b) => a.data.localeCompare(b.data));
}

/* ═══════════════ handler ═══════════════ */
exports.handler = async (event) => {
  const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type':                 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ erro: 'Use POST' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'JSON invalido' }) }; }

  // Porta de entrada: token compartilhado
  const esperado = process.env.PAX_ACCESS_TOKEN;
  if (!esperado) {
    return { statusCode: 500, headers: CORS,
      body: JSON.stringify({ erro: 'PAX_ACCESS_TOKEN nao configurado no Netlify' }) };
  }
  // trim nos dois lados: colar valor com espaco/newline invisivel e comum
  const recebido = String(body.token == null ? '' : body.token).trim();
  const alvo     = String(esperado).trim();
  if (recebido !== alvo) {
    // Diagnostico sem vazar o segredo: tamanhos + primeiro/ultimo caractere
    const dica = 'app enviou ' + recebido.length + ' caractere(s)' +
      (recebido.length ? ' ("' + recebido.slice(0, 3) + '…' + recebido.slice(-2) + '")' : '') +
      ' / Netlify espera ' + alvo.length + ' caractere(s)' +
      ' ("' + alvo.slice(0, 3) + '…' + alvo.slice(-2) + '")';
    return { statusCode: 401, headers: CORS,
      body: JSON.stringify({ erro: 'Token invalido — ' + dica }) };
  }

  try {
    const apiKey = await getApiKey();

    if (body.action === 'cartoes') {
      const cartoes = await listarCartoes(apiKey);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ cartoes }) };
    }

    if (body.action === 'fatura') {
      if (!body.accountId) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'accountId obrigatorio' }) };
      }
      if (!/^\d{4}-\d{2}$/.test(body.mes || '')) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'mes deve ser YYYY-MM' }) };
      }
      const itens = await buscarFatura(apiKey, body.accountId, body.mes);
      const total = Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100;
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ itens, total, mes: body.mes }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'action desconhecida' }) };

  } catch (e) {
    return { statusCode: 502, headers: CORS,
      body: JSON.stringify({ erro: String(e.message || e).slice(0, 300) }) };
  }
};
