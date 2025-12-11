// /api/criar_acao_instagram.js
import connectDB from "./db.js";
import { User, Action, Servico } from './schema.js';
import mongoose from "mongoose";
import axios from "axios";

const SMM_API_KEY = process.env.SMM_API_KEY;
const GANHESOCIAL_URL = process.env.GANHESOCIAL_URL || "https://ganhesocialtest.com/api/smm_acao";
const SEND_TIMEOUT_MS = process.env.SEND_TIMEOUT_MS ? Number(process.env.SEND_TIMEOUT_MS) : 10000;
const RAPIDAPI_TIMEOUT_MS = process.env.RAPIDAPI_TIMEOUT_MS ? Number(process.env.RAPIDAPI_TIMEOUT_MS) : 8000;
const INSTAGRAM_RAPIDAPI_KEY = process.env.INSTAGRAM_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY || process.env.RAPIDAPI || process.env.rapidapi_key || "";

// Função para gerar números aleatórios de 10 dígitos
function gerarNumeroAleatorio10Digitos() {
  // Garante que o número tenha exatamente 10 dígitos (não começa com 0)
  const min = 1000000000; // Menor número de 10 dígitos
  const max = 9999999999; // Maior número de 10 dígitos
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Função para formatar como string com 10 dígitos
function formatar10Digitos(numero) {
  return numero.toString().padStart(10, '0');
}

// cache global simples por processo
global.__rapidapi_cache__ = global.__rapidapi_cache__ || new Map();
const rapidapiCache = global.__rapidapi_cache__;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// FUNÇÃO ADICIONADA: Normaliza qualquer formato de username/link para URL completa do Instagram
function normalizarLinkInstagram(link) {
  if (!link || typeof link !== "string") return null;
  
  let input = link.trim();
  
  // Se já é uma URL completa do Instagram, retorna como está
  if (input.startsWith('https://www.instagram.com/') || input.startsWith('https://instagram.com/')) {
    return input;
  }
  
  // Extrai o username de qualquer formato
  const username = extractInstagramUsernameFromLink(input);
  if (!username) return null;
  
  // Retorna a URL completa formatada
  return `https://www.instagram.com/${username}`;
}

function extractInstagramUsernameFromLink(link) {
  if (!link || typeof link !== "string") return null;
  let s = link.trim();
  s = s.split("?")[0].split("#")[0];
  const atMatch = s.match(/@([A-Za-z0-9._-]+)/);
  if (atMatch && atMatch[1]) return atMatch[1];
  const m = s.match(/(?:instagram\.com\/(?:@)?)([^\/?#&]+)/i);
  if (m && m[1]) return m[1].replace(/\/$/, "");
  s = s.replace(/\/+$/, "");
  const parts = s.split("/");
  const last = parts[parts.length - 1] || "";
  if (last.length > 0) return last.replace(/^@/, "");
  return null;
}

function extractInstagramPostCodeFromLink(link) {
  if (!link || typeof link !== "string") return null;
  const s = link.trim();
  const match = s.match(/(?:\/(?:p|reel|tv)\/)([A-Za-z0-9_-]{4,64})/i);
  if (match && match[1]) return match[1];
  if (/^https?:\/\//i.test(s) || /instagram\.com/i.test(s)) return null;
  const standalone = s.match(/^([A-Za-z0-9_-]{4,64})$/);
  if (standalone && standalone[1]) return standalone[1];
  return null;
}

async function fetchInstagramUser(usernameOrUrl) {
  if (!usernameOrUrl) return null;
  const cacheKey = `ig_user:${String(usernameOrUrl).toLowerCase()}`;
  const cached = rapidapiCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < (60 * 1000)) return cached.data;
  if (!INSTAGRAM_RAPIDAPI_KEY) {
    rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
    return null;
  }
  const url = "https://instagram-social-api.p.rapidapi.com/v1/info";
  const cfg = {
    method: "get",
    url,
    params: { username_or_id_or_url: usernameOrUrl },
    headers: {
      "x-rapidapi-key": INSTAGRAM_RAPIDAPI_KEY,
      "x-rapidapi-host": "instagram-social-api.p.rapidapi.com"
    },
    timeout: RAPIDAPI_TIMEOUT_MS
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await axios(cfg);
      const data = resp?.data ?? null;
      rapidapiCache.set(cacheKey, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status === 400 || status === 404) {
        rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
        return null;
      }
      await sleep(150 * attempt);
    }
  }
  rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
  console.warn("fetchInstagramUser erro:", lastErr?.message || lastErr);
  return null;
}

async function fetchInstagramPost(codeOrUrl) {
  if (!codeOrUrl) return null;
  const cacheKey = `ig_post:${String(codeOrUrl)}`;
  const cached = rapidapiCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < (30 * 1000)) return cached.data;
  if (!INSTAGRAM_RAPIDAPI_KEY) {
    rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
    return null;
  }
  const url = "https://instagram-social-api.p.rapidapi.com/v1/post_info";
  const cfg = {
    method: "get",
    url,
    params: { code_or_id_or_url: codeOrUrl },
    headers: {
      "x-rapidapi-key": INSTAGRAM_RAPIDAPI_KEY,
      "x-rapidapi-host": "instagram-social-api.p.rapidapi.com"
    },
    timeout: RAPIDAPI_TIMEOUT_MS
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await axios(cfg);
      const data = resp?.data ?? null;
      rapidapiCache.set(cacheKey, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      if (status === 400 || status === 404) {
        rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
        return null;
      }
      await sleep(150 * attempt);
    }
  }
  rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
  console.warn("fetchInstagramPost erro:", lastErr?.message || lastErr);
  return null;
}

async function getInitialCountInstagram(link, tipo) {
  try {
    const tipoLower = String(tipo || "").toLowerCase();
    const hasPostPath = typeof link === 'string' && /\/(?:p|reel|tv)\/[A-Za-z0-9_-]{4,64}/i.test(link);
    const postCode = extractInstagramPostCodeFromLink(link || "");
    if ( (tipoLower === "curtidas" || tipoLower === "curtir") && (postCode || hasPostPath) ) {
      const codeOrUrl = postCode ? postCode : link;
      const postData = await fetchInstagramPost(codeOrUrl);
      const likeCount =
        postData?.data?.metrics?.like_count ??
        postData?.data?.like_count ??
        postData?.like_count ??
        null;
      const normalizedLikes = Number.isFinite(Number(likeCount)) ? Number(likeCount) : null;
      console.log(`[contagemInicial][instagram:post] postCode=${postCode || '(url)'} =>`, normalizedLikes);
      return normalizedLikes;
    }
    const username = extractInstagramUsernameFromLink(link || "") || link;
    if (!username) {
      console.log("[contagemInicial][instagram] Username não extraído de link:", link);
      return null;
    }
    const info = await fetchInstagramUser(username);
    const followerCount =
      info?.data?.follower_count ??
      info?.follower_count ??
      info?.data?.followers ??
      null;

    const normalizedFollowers = Number.isFinite(Number(followerCount)) ? Number(followerCount) : null;
    console.log(`[contagemInicial][instagram:user] ${username} =>`, normalizedFollowers);
    return normalizedFollowers;
  } catch (e) {
    console.warn("Erro em getInitialCountInstagram:", e?.message || e);
    return null;
  }
}

async function enviarParaGanheSocial(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const resp = await fetch(GANHESOCIAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SMM_API_KEY}`,
        "User-Agent": "SMM-Sociais-Server"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const raw = await resp.text().catch(() => null);
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch (e) { json = null; }
    return { ok: resp.ok, status: resp.status, statusText: resp.statusText, raw, json };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// Função para buscar serviço no banco de dados
async function buscarServico(id_servico) {
  if (!id_servico) return null;
  
  try {
    const servico = await Servico.findOne({ id_servico: String(id_servico) });
    return servico;
  } catch (error) {
    console.warn("Erro ao buscar serviço:", error?.message || error);
    return null;
  }
}

// Função para calcular valor baseado no preco_1000 do serviço
function calcularValor(quantidade, preco_1000) {
  if (!preco_1000 || preco_1000 <= 0) {
    // Preço padrão caso não tenha preco_1000 definido
    return (quantidade * 0.001).toFixed(2); // R$ 0,001 por unidade
  }
  
  // Calcula: (quantidade / 1000) * preco_1000
  const valor = (quantidade / 1000) * preco_1000;
  return Math.max(valor, 0.01).toFixed(2); // Mínimo de R$ 0,01
}

// Helpers de parsing para pedidos em massa
function parseBulkLines(bulkString) {
  // aceita linhas no formato: ID_SERVICO LINK QUANTIDADE (separados por espaços)
  if (!bulkString || typeof bulkString !== 'string') return [];
  const lines = bulkString.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  
  for (const line of lines) {
    // Dividir por espaços, mas considerar que a URL pode conter espaços
    const parts = line.split(/\s+/).filter(part => part.trim());
    
    if (parts.length < 3) {
      console.warn(`Linha ignorada (formato inválido): ${line}`);
      continue;
    }
    
    // O ID do serviço é a primeira parte
    const id_servico = parts[0];
    
    // A quantidade é a última parte
    const quantidade = parts[parts.length - 1];
    
    // O link é tudo que está no meio
    const link = parts.slice(1, parts.length - 1).join(' ');
    
    // Validar se quantidade é número
    if (isNaN(quantidade) || parseInt(quantidade) < 10) {
      console.warn(`Linha ignorada (quantidade inválida): ${line}`);
      continue;
    }
    
    items.push({ 
      id_servico: id_servico || undefined, 
      link: link || undefined, 
      quantidade: parseInt(quantidade) 
    });
  }
  
  return items;
}

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    await connectDB();

    const { authorization } = req.headers || {};
    const chaveEsperada = `Bearer ${SMM_API_KEY}`;

    if (!authorization) {
      console.warn("🔒 Sem header Authorization");
      return res.status(401).json({ error: "Não autorizado" });
    }

    let usuario = null;
    let isInternalCall = false;

    if (authorization === chaveEsperada) {
      isInternalCall = true;
      console.log("🟣 Chamada interna autenticada via SMM_API_KEY");
    } else if (authorization.startsWith('Bearer ')) {
      const token = authorization.split(' ')[1].trim();
      console.log("🔐 Token recebido (criar_acao_instagram):", token);
      usuario = await User.findOne({ token });
      if (!usuario) {
        console.warn("🔒 Token de usuário não encontrado:", token);
        return res.status(401).json({ error: "Não autorizado" });
      }
      console.log("🧑‍💻 Usuário identificado:", usuario.email);
    } else {
      console.warn("🔒 Authorization header inválido:", authorization);
      return res.status(401).json({ error: "Não autorizado" });
    }

    const body = req.body || {};
    const { bulk, userId: bodyUserId } = body;

    // se chamada interna, usa userId do body
    if (isInternalCall) {
      if (!bodyUserId) {
        return res.status(400).json({ error: "userId obrigatório para chamadas internas" });
      }
      usuario = await User.findById(String(bodyUserId));
      if (!usuario) {
        return res.status(400).json({ error: "Usuário não encontrado!" });
      }
      console.log("🟣 Chamada interna para usuário:", usuario.email);
    }

    // Parse bulk
    let items = [];
    if (bulk && typeof bulk === 'string' && bulk.trim().length > 0) {
      items = parseBulkLines(bulk);
      if (items.length === 0) return res.status(400).json({ error: "Formato de bulk inválido. Use: ID_SERVICO link quantidade (uma linha por pedido, separado por espaços)" });
    } else {
      // tentativa de ler um pedido singular (compatível com rota original)
      const { id_servico, link, quantidade } = body;
      items = [{ 
        id_servico: id_servico ? String(id_servico) : undefined, 
        link: link ? String(link) : undefined, 
        quantidade: quantidade 
      }];
    }

    // AJUSTE PRINCIPAL: Normalizar todos os links para o formato padrão do Instagram
    console.log("🔗 Normalizando links do Instagram...");
    for (const it of items) {
      if (it.link) {
        const linkNormalizado = normalizarLinkInstagram(it.link);
        if (linkNormalizado) {
          console.log(`  → "${it.link}" → "${linkNormalizado}"`);
          it.link = linkNormalizado;
        } else {
          console.warn(`  ⚠ Não foi possível normalizar o link: "${it.link}"`);
        }
      }
    }

    // valida e normaliza items: quantidade (int), id_servico string
    for (const it of items) {
      it.quantidade = Number(it.quantidade);
      if (it.id_servico && typeof it.id_servico !== 'string') {
        it.id_servico = String(it.id_servico);
      }
    }

    console.log("📌 Pedidos a processar (count =", items.length, ")");

    // Buscar informações dos serviços e calcular valores
    for (const it of items) {
      try {
        // Buscar serviço no banco de dados
        const servico = await buscarServico(it.id_servico);
        
        if (!servico) {
          throw new Error(`Serviço com ID ${it.id_servico} não encontrado`);
        }

        // Validar quantidade mínima e máxima do serviço
        if (it.quantidade < (servico.minimo || 10)) {
          throw new Error(`Quantidade mínima para este serviço é ${servico.minimo || 10}`);
        }

        if (servico.maximo && it.quantidade > servico.maximo) {
          throw new Error(`Quantidade máxima para este serviço é ${servico.maximo}`);
        }

        // Definir tipo e calcular valor baseado no preco_1000
        it.tipo = servico.tipo || 'seguidores';
        it.valor = parseFloat(calcularValor(it.quantidade, servico.preco_1000));
        it.servico_nome = servico.nome;
        
        console.log(`💰 Pedido calculado: ID=${it.id_servico}, Tipo=${it.tipo}, Quantidade=${it.quantidade}, Preço_1000=R$ ${servico.preco_1000}, Valor=R$ ${it.valor}`);
        
        // Obter contagem inicial
        it.contagemInicial = await getInitialCountInstagram(it.link || "", it.tipo);
        console.log("📥 contagemInicial obtida (instagram):", it.contagemInicial, "for", it.link);
        
      } catch (e) {
        console.warn("⚠ Erro ao processar pedido:", e?.message || e);
        // Rejeitar o pedido específico em caso de erro
        throw new Error(`Erro no pedido ID ${it.id_servico}: ${e.message}`);
      }
    }

    // Validar quantidade mínima geral (após validações individuais)
    for (const it of items) {
      if (!Number.isInteger(it.quantidade) || it.quantidade < 10 || it.quantidade > 10000000000) {
        return res.status(400).json({ error: `Quantidade inválida para o pedido (id_servico=${it.id_servico || ''}, quantidade=${it.quantidade}). A quantidade mínima é 10.` });
      }
    }

    // iniciar transação
    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      console.log("💳 Saldo do usuário (antes do débito):", usuario.saldo);

      // calcular custo total a debitar
      const custoTotal = items.reduce((acc, it) => acc + Number(it.valor || 0), 0);
      console.log("💰 Custo total a ser debitado:", custoTotal);

      // criar documentos Action (um por linha) com status pendente
      const createdActions = [];
      for (const it of items) {
        const novaAcao = new Action({
          userId: usuario._id,
          id_servico: it.id_servico ? String(it.id_servico) : undefined,
          rede: 'instagram',
          tipo: it.tipo,
          nome: it.servico_nome || it.link || `Pedido ${it.id_servico}`,
          valor: Number(it.valor),
          quantidade: it.quantidade,
          validadas: 0,
          link: it.link, // ← Agora sempre no formato normalizado
          status: "pendente",
          dataCriacao: new Date(),
          contagemInicial: it.contagemInicial
        });
        await novaAcao.save({ session });
        createdActions.push(novaAcao);
      }

      // debitar saldo do usuário
      const debitResult = await User.updateOne(
        { _id: usuario._id, saldo: { $gte: custoTotal } },
        { $inc: { saldo: -custoTotal } },
        { session }
      );

      const modified = debitResult.modifiedCount ?? debitResult.nModified ?? debitResult.n ?? 0;
      const matched = debitResult.matchedCount ?? debitResult.n ?? 0;

      if (!matched || modified === 0) {
        console.warn("❌ O débito não foi aplicado (saldo insuficiente)");
        await session.abortTransaction();
        session.endSession();
        return res.status(402).json({ error: "Saldo insuficiente" });
      }

      await session.commitTransaction();
      session.endSession();

      // atualizar saldo atual
      const usuarioAtualizado = await User.findById(usuario._id).select("saldo");
      console.log("💳 Saldo após o débito:", usuarioAtualizado ? usuarioAtualizado.saldo : "(não encontrado)");

      // enviar cada ação para ganhesocial (fora da transação)
      const resultadosEnvio = [];
      for (const ac of createdActions) {
        const id_pedido = ac._id.toString();
        const nome_usuario = (ac.link && ac.link.includes("@")) ? ac.link.split("@")[1].trim() : (ac.link ? ac.link.trim() : "");
        const quantidade_pontos = +(Number(ac.valor) * 0.001).toFixed(6);
        let tipo_acao = "Outro";
        const tipoLower = (ac.tipo || "").toLowerCase();
        if (tipoLower === "seguidores" || tipoLower === "seguir") tipo_acao = "Seguir";
        else if (tipoLower === "curtidas" || tipoLower === "curtir") tipo_acao = "Curtir";

        const payloadGanheSocial = {
          tipo_acao,
          nome_usuario,
          quantidade_pontos,
          quantidade: ac.quantidade,
          valor: ac.valor,
          url_dir: ac.link, // ← Agora sempre no formato normalizado
          id_pedido,
          meta: {
            contagemInicial: ac.contagemInicial,
          }
        };

        try {
          console.log("📤 Enviando ação para ganhesocial ->", GANHESOCIAL_URL, "id_pedido:", id_pedido);
          const sendResult = await enviarParaGanheSocial(payloadGanheSocial);
          console.log("📩 Resposta ganhesocial:", sendResult.status, sendResult.statusText);
// Gerar número aleatório de 10 dígitos
const numeroAleatorio = gerarNumeroAleatorio10Digitos();
const idAcaoSMMFormatado = formatar10Digitos(numeroAleatorio);

try {
  await Action.findByIdAndUpdate(id_pedido, { 
    id_acao_smm: idAcaoSMMFormatado 
  });
  console.log("🔁 Action atualizado com id_acao_smm gerado:", idAcaoSMMFormatado);
  
  // Adicionar ao resultado para retorno
  resultadosEnvio.push({ 
    ...resultadosEnvio[resultadosEnvio.length - 1],
    id_acao_smm_gerado: idAcaoSMMFormatado
  });
} catch (errUpdate) {
  console.error("❌ Falha ao atualizar Action com id_acao_smm:", errUpdate);
}
          resultadosEnvio.push({ id_pedido, ok: sendResult.ok, status: sendResult.status, json: sendResult.json, raw: sendResult.raw });
        } catch (errSend) {
          console.error("❌ ERRO ao enviar para ganhesocial:", errSend && errSend.message ? errSend.message : errSend);
          resultadosEnvio.push({ id_pedido, ok: false, error: errSend?.message || String(errSend) });
        }
      }

      // resposta final (201) com lista de ids criados
      return res.status(201).json({
        message: "Ações criadas com sucesso",
        pedidos: createdActions.map(a => ({ 
          id_pedido: a._id.toString(), 
          link: a.link, // ← Agora sempre no formato normalizado
          quantidade: a.quantidade, 
          valor: a.valor, 
          tipo: a.tipo,
          contagemInicial: a.contagemInicial 
        })),
        resultadosEnvio,
        newSaldo: usuarioAtualizado ? usuarioAtualizado.saldo : null,
        custoTotal: custoTotal
      });

    } catch (txErr) {
      try { await session.abortTransaction(); } catch (e2) { console.error("Erro abortando transação:", e2); }
      session.endSession();
      console.error("❌ Erro durante transação:", txErr);
      return res.status(500).json({ error: "Erro ao criar ações (transação)." });
    }

  } catch (error) {
    console.error("❌ Erro interno ao criar ação:", error);
    return res.status(500).json({ error: error.message || "Erro ao criar ação" });
  }
};

export default handler;
