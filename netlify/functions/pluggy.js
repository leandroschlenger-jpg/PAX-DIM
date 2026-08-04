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

/* ── Lista as contas de cartão de crédito de um ou mais Items ──
   A API da Pluggy NAO tem endpoint para listar todos os items:
   existe apenas GET /items/:id. Por isso o Item ID e informado
   pelo app (o usuario copia do Dashboard Pluggy).              */
async function listarCartoes(apiKey, itemIds) {
  if (!itemIds || itemIds.length === 0) {
    throw new Error('Informe o Item ID (copie no Dashboard Pluggy > sua aplicacao > Items/Connections)');
  }
  const out = [], erros = [];
  for (const rawId of itemIds) {
    const itemId = String(rawId).trim();
    if (!itemId) continue;

    let item = null;
    try {
      item = await pget('/items/' + encodeURIComponent(itemId), apiKey);
    } catch (e) {
      erros.push(itemId.slice(0, 8) + '…: ' + String(e.message).slice(0, 90));
      continue;
    }

    let accs;
    try {
      accs = await pget('/accounts?itemId=' + encodeURIComponent(itemId), apiKey);
    } catch (e) {
      erros.push(itemId.slice(0, 8) + '… (contas): ' + String(e.message).slice(0, 90));
      continue;
    }

    const banco = (item.connector && item.connector.name) || 'Banco';
    for (const a of (accs.results || [])) {
      if (a.type === 'CREDIT' || a.subtype === 'CREDIT_CARD') {
        out.push({
          accountId:  a.id,
          itemId:     itemId,
          banco:      banco,
          nome:       a.name || a.marketingName || 'Cartao',
          numero:     a.number || '',
          bandeira:   (a.creditData && a.creditData.brand) || '',
          limite:     (a.creditData && a.creditData.creditLimit) || null,
          vencimento: (a.creditData && a.creditData.balanceDueDate) || null,
          status:     item.status || ''
        });
      }
    }
    // Se o item conectou mas nao tem cartao, avisa quais contas veio
    if ((accs.results || []).length && !out.length) {
      const tipos = (accs.results || []).map(a => (a.type || '?') + '/' + (a.subtype || '?')).join(', ');
      erros.push(banco + ': nenhuma conta de cartao (encontrado: ' + tipos + ')');
    }
  }
  if (out.length === 0 && erros.length) throw new Error(erros.join(' | '));
  return out;
}

/* ── Busca as transações da fatura de um mês ──
   IMPORTANTE: a fatura que vence em agosto contem as compras do
   ciclo de JULHO. Por isso NUNCA se filtra pela data da compra
   dentro do mes pedido — o vinculo correto e, em ordem:
     1. creditCardMetadata.billId  == id da bill que vence no mes
     2. creditCardMetadata.billForecastDate == mes
     3. janela do ciclo (fechamento anterior -> fechamento atual)
   O "mes" sempre se refere ao mes de VENCIMENTO da fatura.        */
async function buscarFatura(apiKey, accountId, mes, bill, billIdDireto) {
  const [ano, m] = mes.split('-').map(Number);
  const fmtD = d => d.toISOString().slice(0, 10);

  // Janela ampla: parcelas antigas entram em faturas novas
  const ini = new Date(Date.UTC(ano, m - 1, 1));
  ini.setUTCDate(ini.getUTCDate() - 150);
  const fim = new Date(Date.UTC(ano, m, 0));
  fim.setUTCDate(fim.getUTCDate() + 40);

  let todas = [], url = '/v2/transactions?accountId=' + encodeURIComponent(accountId) +
    '&dateFrom=' + fmtD(ini) + '&dateTo=' + fmtD(fim), guard = 0;

  while (url && guard++ < 20) {
    const page = await pget(url, apiKey);
    todas = todas.concat(page.results || []);
    url = page.next ? '/v2/transactions' + page.next : null;
  }

  // Só compras (DEBIT). Pagamentos da fatura (CREDIT) não são itens.
  const compras = todas.filter(t => t.type === 'DEBIT');
  const cmd = t => t.creditCardMetadata || {};

  const montar = arr => arr.map(t => {
    const cc  = t.creditCardMetadata || {};
    const parc = (cc.installmentNumber && cc.totalInstallments && cc.totalInstallments > 1)
      ? ' ' + cc.installmentNumber + '/' + cc.totalInstallments
      : '';
    const nome = (t.merchant && t.merchant.name) || t.description || 'Compra';
    return {
      extId:      t.id,
      descricao:  (nome + parc).slice(0, 80),
      valor:      Math.round(Math.abs(t.amount) * 100) / 100,
      data:       String(cc.purchaseDate || t.date).slice(0, 10),
      categoria:  mapCat(t.category),
      status:     t.status === 'POSTED' ? 'OK' : '',
      confirmada: t.status === 'POSTED',
      parcela:    parc.trim() || null,
      catOrig:    t.category || null
    };
  }).sort((a, b) => a.data.localeCompare(b.data));

  let sel = [], criterio = null;

  // 0) billId escolhido explicitamente pelo usuario — tem prioridade absoluta
  if (billIdDireto) {
    sel = compras.filter(t => cmd(t).billId === billIdDireto);
    criterio = 'billIdEscolhido';
    if (!sel.length) criterio = 'billIdEscolhido:vazio';
    return { itens: montar(sel), criterio };
  }

  // 1) Vinculo direto com a bill — o mais confiavel
  if (bill && bill.id) {
    sel = compras.filter(t => cmd(t).billId === bill.id);
    if (sel.length) criterio = 'billId';
  }

  // 2) Mes previsto da fatura informado pela instituicao
  if (!sel.length) {
    sel = compras.filter(t => cmd(t).billForecastDate === mes);
    if (sel.length) criterio = 'billForecastDate';
  }

  // 3) Janela do ciclo: do fechamento anterior ate o fechamento desta fatura
  if (!sel.length) {
    let corteFim;
    if (bill && bill.billClosingDate)      corteFim = new Date(bill.billClosingDate);
    else if (bill && bill.dueDate)         { corteFim = new Date(bill.dueDate); corteFim.setUTCDate(corteFim.getUTCDate() - 7); }
    else                                   corteFim = new Date(Date.UTC(ano, m - 1, 1)); // fim de julho p/ fatura de agosto
    const corteIni = new Date(corteFim);
    corteIni.setUTCMonth(corteIni.getUTCMonth() - 1);
    const a = fmtD(corteIni), b = fmtD(corteFim);
    sel = compras.filter(t => {
      const d = String(cmd(t).purchaseDate || t.date).slice(0, 10);
      return d > a && d <= b;
    });
    criterio = 'cicloEstimado:' + a + '..' + b;
  }

  return { itens: montar(sel), criterio };
}

/* ── Lista TODAS as faturas do cartao, com resumo do que cada uma contem ──
   Serve para o usuario escolher explicitamente qual fatura importar,
   sem depender de adivinhar a relacao mes-do-app -> ciclo do banco.  */
async function listarFaturas(apiKey, accountId) {
  const bills = await pget('/bills?accountId=' + encodeURIComponent(accountId), apiKey);
  const lista = (bills.results || []).slice();

  // Puxa transacoes de uma janela ampla para contar itens por fatura
  const hoje = new Date();
  const ini  = new Date(hoje); ini.setUTCMonth(ini.getUTCMonth() - 8);
  const fmtD = d => d.toISOString().slice(0, 10);
  let todas = [], url = '/v2/transactions?accountId=' + encodeURIComponent(accountId) +
    '&dateFrom=' + fmtD(ini), guard = 0;
  try {
    while (url && guard++ < 25) {
      const page = await pget(url, apiKey);
      todas = todas.concat(page.results || []);
      url = page.next ? '/v2/transactions' + page.next : null;
    }
  } catch (e) { /* segue com o que deu */ }

  const compras = todas.filter(t => t.type === 'DEBIT');
  const porBill = {}, porForecast = {};
  for (const t of compras) {
    const cc = t.creditCardMetadata || {};
    if (cc.billId) {
      porBill[cc.billId] = porBill[cc.billId] || { n: 0, soma: 0 };
      porBill[cc.billId].n++; porBill[cc.billId].soma += Math.abs(t.amount);
    }
    if (cc.billForecastDate) {
      porForecast[cc.billForecastDate] = porForecast[cc.billForecastDate] || { n: 0, soma: 0 };
      porForecast[cc.billForecastDate].n++; porForecast[cc.billForecastDate].soma += Math.abs(t.amount);
    }
  }

  const hojeStr = fmtD(hoje);
  const out = lista.map(b => {
    const venc  = String(b.dueDate || '').slice(0, 10);
    const fecha = b.billClosingDate ? String(b.billClosingDate).slice(0, 10) : null;
    const mesVenc = venc.slice(0, 7);
    const agg = porBill[b.id] || porForecast[mesVenc] || { n: 0, soma: 0 };
    return {
      billId:     b.id,
      mes:        mesVenc,
      vencimento: venc,
      fechamento: fecha,
      fechada:    fecha ? (fecha <= hojeStr) : (venc < hojeStr),
      totalBanco: b.totalAmount == null ? null : Math.round(b.totalAmount * 100) / 100,
      minimo:     b.minimumPaymentAmount == null ? null : Math.round(b.minimumPaymentAmount * 100) / 100,
      encargos:   Math.round((b.financeCharges || []).reduce((s, c) => s + (c.amount || 0), 0) * 100) / 100,
      qtdItens:   agg.n,
      somaItens:  Math.round(agg.soma * 100) / 100,
      vinculo:    porBill[b.id] ? 'billId' : (porForecast[mesVenc] ? 'forecast' : 'nenhum')
    };
  }).sort((a, b) => String(b.vencimento).localeCompare(String(a.vencimento)));

  // Meses previstos que ainda nao tem bill emitida (fatura em formacao)
  const mesesComBill = {}; out.forEach(o => { mesesComBill[o.mes] = 1; });
  const emFormacao = Object.keys(porForecast)
    .filter(m => !mesesComBill[m])
    .sort()
    .map(m => ({
      billId: null, mes: m, vencimento: null, fechamento: null, fechada: false,
      totalBanco: null, minimo: null, encargos: 0,
      qtdItens: porForecast[m].n,
      somaItens: Math.round(porForecast[m].soma * 100) / 100,
      vinculo: 'forecast', emFormacao: true
    }));

  return { faturas: out, emFormacao };
}

/* ── Acha a bill (fatura) que VENCE no mes pedido ── */
async function acharBill(apiKey, accountId, mes, billIdDireto) {
  try {
    const bills = await pget('/bills?accountId=' + encodeURIComponent(accountId), apiKey);
    const lista = bills.results || [];
    // Se o usuario escolheu uma fatura, ela manda
    const achada = billIdDireto
      ? lista.find(b => b.id === billIdDireto)
      : lista.find(b => String(b.dueDate || '').slice(0, 7) === mes);
    return {
      bill: achada || null,
      // meses disponiveis, para orientar quando o mes pedido nao existe
      disponiveis: lista.map(b => String(b.dueDate || '').slice(0, 7)).filter(Boolean).sort()
    };
  } catch (e) {
    return { bill: null, disponiveis: [], erro: String(e.message).slice(0, 120) };
  }
}

/* ── Traduz a bill em status legivel ── */
function statusDaBill(bill) {
  if (!bill) return { temBill: false, fechada: null, fechamento: null, vencimento: null, totalBanco: null };
  const hoje  = new Date().toISOString().slice(0, 10);
  const venc  = String(bill.dueDate || '').slice(0, 10);
  const fecha = bill.billClosingDate ? String(bill.billClosingDate).slice(0, 10) : null;
  return {
    temBill:    true,
    fechada:    fecha ? (fecha <= hoje) : (venc < hoje),
    fechamento: fecha,
    vencimento: venc,
    totalBanco: bill.totalAmount == null ? null : Math.round(bill.totalAmount * 100) / 100
  };
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
      // aceita string ("id" ou "id1,id2") ou array
      let ids = body.itemIds || body.itemId || [];
      if (typeof ids === 'string') ids = ids.split(/[,;\s]+/);
      if (!Array.isArray(ids)) ids = [ids];
      ids = ids.map(s => String(s).trim()).filter(Boolean);
      const cartoes = await listarCartoes(apiKey, ids);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ cartoes }) };
    }

    if (body.action === 'faturas') {
      if (!body.accountId) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'accountId obrigatorio' }) };
      }
      const r = await listarFaturas(apiKey, body.accountId);
      return { statusCode: 200, headers: CORS, body: JSON.stringify(r) };
    }

    if (body.action === 'fatura') {
      if (!body.accountId) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'accountId obrigatorio' }) };
      }
      if (!/^\d{4}-\d{2}$/.test(body.mes || '')) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'mes deve ser YYYY-MM' }) };
      }
      const { bill, disponiveis } = await acharBill(apiKey, body.accountId, body.mes, body.billId);
      const { itens, criterio }   = await buscarFatura(apiKey, body.accountId, body.mes, bill, body.billId);
      const soma = arr => Math.round(arr.reduce((s, i) => s + i.valor, 0) * 100) / 100;
      const conf = itens.filter(i => i.confirmada);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        itens,
        total:           soma(itens),
        totalConfirmado: soma(conf),
        qtdConfirmada:   conf.length,
        qtdPendente:     itens.length - conf.length,
        fatura:          statusDaBill(bill),
        criterio,                       // como os itens foram amarrados a fatura
        mesesDisponiveis: disponiveis,  // faturas que o banco expoe
        mes:             body.mes
      }) };
    }

    return { statusCode: 400, headers: CORS, body: JSON.stringify({ erro: 'action desconhecida' }) };

  } catch (e) {
    return { statusCode: 502, headers: CORS,
      body: JSON.stringify({ erro: String(e.message || e).slice(0, 300) }) };
  }
};
