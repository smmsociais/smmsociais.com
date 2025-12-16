// /api/criar_acao_tiktok.js
import connectDB from "./db.js";
import { User, Action, Servico } from './schema.js';
import mongoose from "mongoose";
import axios from "axios";
import jwt from "jsonwebtoken";

const SMM_API_KEY = process.env.SMM_API_KEY;
const GANHESOCIAL_URL = process.env.GANHESOCIAL_URL || "https://ganhesocial.com/api/smm_acao";
const SEND_TIMEOUT_MS = process.env.SEND_TIMEOUT_MS ? Number(process.env.SEND_TIMEOUT_MS) : 10000;
const RAPIDAPI_TIMEOUT_MS = process.env.RAPIDAPI_TIMEOUT_MS ? Number(process.env.RAPIDAPI_TIMEOUT_MS) : 8000;

// RapidAPI key (Scraptik)
const SCRAPTIK_KEY = process.env.SCRAPTIK_KEY || process.env.RAPIDAPI_KEY || process.env.RAPIDAPI || process.env.rapidapi_key || "";

// cache global simples por processo
global.__rapidapi_cache__ = global.__rapidapi_cache__ || new Map();
const rapidapiCache = global.__rapidapi_cache__;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// FUNÇÃO ADICIONADA: Normaliza qualquer formato de username/link para URL completa do TikTok
function normalizarLinkTikTok(link) {
  if (!link || typeof link !== "string") return null;
  
  let input = link.trim();
  
  // Se já é uma URL completa do TikTok, retorna como está
  if (input.startsWith('https://www.tiktok.com/@')) {
    return input;
  }
  
  // Extrai o username de qualquer formato
  const username = extractUsernameFromLink(input);
  if (!username) return null;
  
  // Retorna a URL completa formatada
  return `https://www.tiktok.com/@${username}`;
}

// extrai username de link/nomes variados
function extractUsernameFromLink(link) {
  if (!link || typeof link !== "string") return null;
  let s = link.trim();
  s = s.split("?")[0].split("#")[0];
  // @user
  const atMatch = s.match(/@([A-Za-z0-9._-]+)/);
  if (atMatch && atMatch[1]) return atMatch[1];
  // tiktok.com/@user
  const m = s.match(/(?:tiktok\.com\/(?:@)?)([^\/?#&]+)/i);
  if (m && m[1]) return m[1].replace(/\/$/, "");
  // fallback: último segmento
  s = s.replace(/\/+$/, "");
  const parts = s.split("/");
  const last = parts[parts.length - 1] || "";
  if (last.length > 0) return last.replace(/^@/, "");
  return null;
}

// extrai aweme_id (id do post/video) de um link do TikTok ou de uma string contendo o id
function extractAwemeIdFromLink(link) {
  if (!link || typeof link !== "string") return null;
  const s = link.trim();

  // padrão tiktok.com/.../video/1234567890123456789 ou /photo/ID
  const matchVideo = s.match(/(?:video|photo)\/(\d{6,30})/i);
  if (matchVideo && matchVideo[1]) return matchVideo[1];

  // às vezes o id aparece como query ou somente números longos no fim
  const generalMatch = s.match(/\b(\d{6,30})\b/);
  if (generalMatch && generalMatch[1]) return generalMatch[1];

  return null;
}

// fetcher Scraptik (TikTok) — dados do usuário (seguidores), retorna objeto ou null
async function fetchTikTokUser(username) {
  if (!username) return null;
  const cacheKey = `tiktok_user:${username.toLowerCase()}`;
  const cached = rapidapiCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < (60 * 1000)) return cached.data;

  if (!SCRAPTIK_KEY) {
    rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
    return null;
  }

  const url = "https://scraptik.p.rapidapi.com/get-user";
  const cfg = {
    method: "get",
    url,
    params: { username },
    headers: {
      "x-rapidapi-key": SCRAPTIK_KEY,
      "x-rapidapi-host": "scraptik.p.rapidapi.com"
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
  console.warn("fetchTikTokUser erro:", lastErr?.message || lastErr);
  return null;
}

// fetcher Scraptik (TikTok) — dados do post (get-post) retorna objeto ou null
async function fetchTikTokPost(awemeId) {
  if (!awemeId) return null;
  const cacheKey = `tiktok_post:${awemeId}`;
  const cached = rapidapiCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < (30 * 1000)) return cached.data; // cache mais curto

  if (!SCRAPTIK_KEY) {
    rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
    return null;
  }

  const url = "https://scraptik.p.rapidapi.com/get-post";
  const cfg = {
    method: "get",
    url,
    params: { aweme_id: awemeId },
    headers: {
      "x-rapidapi-key": SCRAPTIK_KEY,
      "x-rapidapi-host": "scraptik.p.rapidapi.com"
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
  console.warn("fetchTikTokPost erro:", lastErr?.message || lastErr);
  return null;
}

// obtém contagem inicial (number|null) baseado na rede/link e tipo
async function getInitialCountTikTok(link, tipo) {
  try {
    const tipoLower = String(tipo || "").toLowerCase();

    // extrair aweme_id primeiro (se existir)
    const awemeId = extractAwemeIdFromLink(link || "");
    
    // se for pedido de curtidas/visualizações ou tiver aweme id, buscar contagem do post
    if ((tipoLower === "curtidas" || tipoLower === "curtir" || tipoLower === "visualizacoes" || tipoLower === "views") || awemeId) {
      const postData = await fetchTikTokPost(awemeId);
      
      let count = null;
      if (tipoLower === "curtidas" || tipoLower === "curtir") {
        // Buscar curtidas (digg_count)
        count = postData?.aweme_detail?.statistics?.digg_count ??
                postData?.statistics?.digg_count ??
                postData?.aweme_detail?.statistics?.diggCount ??
                postData?.statistics?.diggCount ?? null;
      } else if (tipoLower === "visualizacoes" || tipoLower === "views") {
        // Buscar visualizações (play_count)
        count = postData?.aweme_detail?.statistics?.play_count ??
                postData?.statistics?.play_count ??
                postData?.aweme_detail?.statistics?.playCount ??
                postData?.statistics?.playCount ?? null;
      }

      const normalized = Number.isFinite(Number(count)) ? Number(count) : null;
      console.log(`[contagemInicial][tiktok:post] awemeId=${awemeId}, tipo=${tipoLower} =>`, normalized);
      return normalized;
    }

    // caso não seja curtidas/visualizações nem aweme id — tentamos buscar dados do usuário (followers)
    const username = extractUsernameFromLink(link || "");
    if (!username) {
      console.log("[contagemInicial] Username não extraído de link:", link);
      return null;
    }
    
    const info = await fetchTikTokUser(username);
    const count = info?.user?.follower_count ?? info?.user?.followerCount ?? null;
    const normalized = Number.isFinite(Number(count)) ? Number(count) : null;
    console.log(`[contagemInicial][tiktok:user] ${username} =>`, normalized);
    return normalized;

  } catch (e) {
    console.warn("Erro em getInitialCountTikTok:", e?.message || e);
    return null;
  }
}

// enviar para ganhesocial
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

    let usuario = null;
    let isInternalCall = false;

    if (!authorization) {
      console.warn("🔒 Sem header Authorization");
      return res.status(401).json({ error: "Não autorizado" });
    }

    // chamada interna via SMM_API_KEY (exata)
    if (authorization === chaveEsperada) {
      isInternalCall = true;
      console.log("🟣 Chamada interna autenticada via SMM_API_KEY");
    } else if (authorization.startsWith('Bearer ')) {
      const token = authorization.split(' ')[1].trim();
      console.log("🔐 Token recebido (criar_acao_instagram):", token.slice(0, 12) + "...");

      // 1) Tentar decodificar/verificar como JWT (recomendado)
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || "");
        // payload esperado ter { id } ou { _id } — ajuste conforme seu fluxo
        const userIdFromJwt = payload?.id || payload?._id || payload?.userId;
        if (userIdFromJwt) {
          usuario = await User.findById(String(userIdFromJwt));
          if (usuario) {
            console.log("🧾 Usuário identificado via JWT:", usuario.email, usuario._id.toString());
          }
        }
      } catch (e) {
        // não é um JWT válido — pode ser um token legado
        console.log("⚠ token não é JWT válido (ou expirado):", e.message);
      }

      // 2) Fallback: tentar encontrar pelo campo token no DB (legacy)
      if (!usuario) {
        try {
          usuario = await User.findOne({ token });
          if (usuario) console.log("🧾 Usuário identificado via campo token no DB:", usuario.email);
        } catch (e) {
          console.warn("Erro buscando usuário por token no DB:", e?.message || e);
        }
      }

      if (!usuario) {
        console.warn("🔒 Token de usuário não encontrado:", token.slice(0, 12) + "...");
        return res.status(401).json({ error: "Não autorizado" });
      }

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

    // AJUSTE PRINCIPAL: Normalizar todos os links para o formato padrão do TikTok
    console.log("🔗 Normalizando links do TikTok...");
    for (const it of items) {
      if (it.link) {
        const linkNormalizado = normalizarLinkTikTok(it.link);
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
        it.contagemInicial = await getInitialCountTikTok(it.link || "", it.tipo);
        console.log("📥 contagemInicial obtida (tiktok):", it.contagemInicial, "for", it.link);
        
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
          rede: 'tiktok',
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
        else if (tipoLower === "visualizacoes" || tipoLower === "views") tipo_acao = "Visualizar";

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
          if (sendResult.json && sendResult.json.id_acao_smm) {
            try {
              await Action.findByIdAndUpdate(id_pedido, { id_acao_smm: sendResult.json.id_acao_smm });
              console.log("🔁 Action atualizado com id_acao_smm:", sendResult.json.id_acao_smm);
            } catch (errUpdate) {
              console.error("❌ Falha ao atualizar Action com id_acao_smm:", errUpdate);
            }
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
