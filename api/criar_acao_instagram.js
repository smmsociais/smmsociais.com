// /api/criar_acao_instagram.js
import connectDB from "./db.js";
import { User, Action } from './schema.js';
import mongoose from "mongoose";
import axios from "axios";

const SMM_API_KEY = process.env.SMM_API_KEY;
const GANHESOCIAL_URL = process.env.GANHESOCIAL_URL || "https://ganhesocialtest.com/api/smm_acao";
const SEND_TIMEOUT_MS = process.env.SEND_TIMEOUT_MS ? Number(process.env.SEND_TIMEOUT_MS) : 10000;
const RAPIDAPI_TIMEOUT_MS = process.env.RAPIDAPI_TIMEOUT_MS ? Number(process.env.RAPIDAPI_TIMEOUT_MS) : 8000;

// RapidAPI key for instagram-social-api
const INSTAGRAM_RAPIDAPI_KEY = process.env.INSTAGRAM_RAPIDAPI_KEY || process.env.RAPIDAPI_KEY || process.env.RAPIDAPI || process.env.rapidapi_key || "";

// cache global simples por processo
global.__rapidapi_cache__ = global.__rapidapi_cache__ || new Map();
const rapidapiCache = global.__rapidapi_cache__;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// extrai username de link/nomes variados (instagram)
function extractInstagramUsernameFromLink(link) {
  if (!link || typeof link !== "string") return null;
  let s = link.trim();
  s = s.split("?")[0].split("#")[0];
  // @user
  const atMatch = s.match(/@([A-Za-z0-9._-]+)/);
  if (atMatch && atMatch[1]) return atMatch[1];
  // instagram.com/username
  const m = s.match(/(?:instagram\.com\/(?:@)?)([^\/?#&]+)/i);
  if (m && m[1]) return m[1].replace(/\/$/, "");
  // fallback: último segmento
  s = s.replace(/\/+$/, "");
  const parts = s.split("/");
  const last = parts[parts.length - 1] || "";
  if (last.length > 0) return last.replace(/^@/, "");
  return null;
}

// extrai post code/id de link do Instagram (p/ /p/ , /reel/ , /tv/ etc)
// agora: só aceita quando encontra explicitamente /p/ /reel/ /tv/ OU quando a entrada
// for um código standalone (sem http, sem instagram.com, sem @).
function extractInstagramPostCodeFromLink(link) {
  if (!link || typeof link !== "string") return null;
  const s = link.trim();

  // 1) padrão explícito em URLs: /p/CODE/   /reel/CODE/   /tv/CODE/
  const match = s.match(/(?:\/(?:p|reel|tv)\/)([A-Za-z0-9_-]{4,64})/i);
  if (match && match[1]) return match[1];

  // 2) se a string parece ser uma URL de instagram (ou qualquer URL) mas não contém /p|/reel|/tv
  // então não vamos tentar "adivinhar" o código (evita pegar 'https', 'instagram', etc).
  if (/^https?:\/\//i.test(s) || /instagram\.com/i.test(s)) {
    return null;
  }

  // 3) se for um código standalone (ex: "DQjyfO3gDO6") — sem http e sem @ — aceitável
  const standalone = s.match(/^([A-Za-z0-9_-]{4,64})$/);
  if (standalone && standalone[1]) return standalone[1];

  return null;
}

// consulta followers via instagram-social-api /v1/info
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

// consulta likes do post via instagram-social-api /v1/post_info
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

    // detecta se a URL contém caminho de post (/p/ /reel/ /tv/)
    const hasPostPath = typeof link === 'string' && /\/(?:p|reel|tv)\/[A-Za-z0-9_-]{4,64}/i.test(link);
    const postCode = extractInstagramPostCodeFromLink(link || "");

    // Só chama fetchInstagramPost quando temos certeza de que é um post:
    // - existe postCode (standalone ou extraído do path) OR
    // - o tipo é curtidas **e** o link contém explicitamente /p/|/reel/|/tv/
    if ( (tipoLower === "curtidas" || tipoLower === "curtir") && (postCode || hasPostPath) ) {
      const codeOrUrl = postCode ? postCode : link; // se postCode for null mas hasPostPath=true, passamos a URL inteira
      const postData = await fetchInstagramPost(codeOrUrl);
      // caminho esperado: data.metrics.like_count ou data.like_count
      const likeCount =
        postData?.data?.metrics?.like_count ??
        postData?.data?.like_count ??
        postData?.like_count ??
        null;

      const normalizedLikes = Number.isFinite(Number(likeCount)) ? Number(likeCount) : null;
      console.log(`[contagemInicial][instagram:post] postCode=${postCode || '(url)'} =>`, normalizedLikes);
      return normalizedLikes;
    }

    // caso contrário, buscar follower_count do usuário (perfil)
    const username = extractInstagramUsernameFromLink(link || "") || link;
    if (!username) {
      console.log("[contagemInicial][instagram] Username não extraído de link:", link);
      return null;
    }

    const info = await fetchInstagramUser(username);
    // caminho esperado: data.follower_count
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

// enviar para ganhesocial (mantido)
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

    const {
      rede,
      tipo,
      nome,
      valor,
      quantidade,
      link,
      userId: bodyUserId,
      id_servico
    } = req.body || {};

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

    // validações
    if (id_servico && typeof id_servico !== "string") {
      return res.status(400).json({ error: "id_servico inválido" });
    }

    const valorNum = parseFloat(valor);
    const quantidadeNum = Number(quantidade);

    if (isNaN(valorNum) || valorNum <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    if (!Number.isInteger(quantidadeNum) || quantidadeNum < 10 || quantidadeNum > 10000000000) {
      return res.status(400).json({ error: "A quantidade minima para este pedido é de 10" });
    }

    console.log("📌 Dados recebidos:");
    console.log("   ➤ Valor unitário:", valorNum);
    console.log("   ➤ Quantidade:", quantidadeNum);

    // tenta obter contagem inicial (espera o resultado para gravar no documento)
    let contagemInicial = null;
    try {
      // chama função específica do Instagram
      contagemInicial = await getInitialCountInstagram(link || nome || "", tipo);
      console.log("📥 contagemInicial obtida (instagram):", contagemInicial);
    } catch (e) {
      console.warn("⚠ Erro ao obter contagemInicial (continuando):", e?.message || e);
      contagemInicial = null;
    }

    // Inicia sessão / transação
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      console.log("💳 Saldo do usuário (antes do débito):", usuario.saldo);

      // débito APENAS do valor unitário
      const custoATerDebitado = valorNum;
      console.log("💰 Valor que será debitado (unitário):", custoATerDebitado);

      // Criar a action (na transação) incluindo contagemInicial
      const novaAcao = new Action({
        userId: usuario._id,
        id_servico: id_servico ? String(id_servico) : undefined,
        rede,
        tipo,
        nome,
        valor: valorNum,
        quantidade: quantidadeNum,
        validadas: 0,
        link,
        status: "pendente",
        dataCriacao: new Date(),
        contagemInicial: contagemInicial // number | null
      });

      await novaAcao.save({ session });

      // debitar saldo
      console.log("🧮 Tentando debitar...");
      const debitResult = await User.updateOne(
        { _id: usuario._id, saldo: { $gte: custoATerDebitado } },
        { $inc: { saldo: -custoATerDebitado } },
        { session }
      );

      console.log("📊 Resultado do débito:", debitResult);

      const modified = debitResult.modifiedCount ?? debitResult.nModified ?? debitResult.n ?? 0;
      const matched = debitResult.matchedCount ?? debitResult.n ?? 0;

      if (!matched || modified === 0) {
        console.warn("❌ O débito não foi aplicado (saldo insuficiente)");
        await session.abortTransaction();
        session.endSession();
        return res.status(402).json({ error: "Saldo insuficiente" });
      }

      // commit da transação
      await session.commitTransaction();
      session.endSession();

      const id_pedido = novaAcao._id.toString();
      console.log("🆔 Ação criada com ID:", id_pedido);

      // buscar novo saldo (fora da transação)
      const usuarioAtualizado = await User.findById(usuario._id).select("saldo");
      console.log("💳 Saldo após o débito:", usuarioAtualizado ? usuarioAtualizado.saldo : "(não encontrado)");

      // montar payload para ganhesocial (mantendo compatibilidade)
      const nome_usuario = (link && link.includes("@")) ? link.split("@")[1].trim() : (link ? link.trim() : "");
      const quantidade_pontos = +(valorNum * 0.001).toFixed(6);
      let tipo_acao = "Outro";
      const tipoLower = (tipo || "").toLowerCase();
      if (tipoLower === "seguidores" || tipoLower === "seguir") tipo_acao = "Seguir";
      else if (tipoLower === "curtidas" || tipoLower === "curtir") tipo_acao = "Curtir";

      const payloadGanheSocial = {
        tipo_acao,
        nome_usuario,
        quantidade_pontos,
        quantidade: quantidadeNum,
        valor: valorNum,
        url_dir: link,
        id_pedido,
        meta: {
          contagemInicial: contagemInicial,
        }
      };

      // Envia para ganhesocial (tenta atualizar id_acao_smm)
      try {
        console.log("📤 Enviando ação para ganhesocial ->", GANHESOCIAL_URL);
        const sendResult = await enviarParaGanheSocial(payloadGanheSocial);

        console.log("📩 Resposta ganhesocial:", sendResult.status, sendResult.statusText);
        if (sendResult.json) console.log("📩 JSON:", sendResult.json);
        else if (sendResult.raw) console.log("📩 Raw:", sendResult.raw);

        if (sendResult.ok && sendResult.json && sendResult.json.id_acao_smm) {
          try {
            await Action.findByIdAndUpdate(id_pedido, { id_acao_smm: sendResult.json.id_acao_smm });
            console.log("🔁 Action atualizado com id_acao_smm:", sendResult.json.id_acao_smm);
          } catch (errUpdate) {
            console.error("❌ Falha ao atualizar Action com id_acao_smm:", errUpdate);
          }
        } else if (!sendResult.ok) {
          console.warn("⚠️ ganhesocial retornou erro:", sendResult.status, sendResult.json ?? sendResult.raw);
        }
      } catch (errSend) {
        if (errSend.name === "AbortError") {
          console.error(`❌ ERRO FETCH: Abort devido a timeout (${SEND_TIMEOUT_MS}ms)`);
        } else {
          console.error("❌ ERRO FETCH:", errSend && errSend.message ? errSend.message : errSend);
        }
      }

      // resposta final
      return res.status(201).json({
        message: "Ação criada com sucesso",
        id_pedido,
        newSaldo: usuarioAtualizado ? usuarioAtualizado.saldo : null,
        contagemInicial
      });

    } catch (txErr) {
      try { await session.abortTransaction(); } catch (e2) { console.error("Erro abortando transação:", e2); }
      session.endSession();
      console.error("❌ Erro durante transação:", txErr);
      return res.status(500).json({ error: "Erro ao criar ação (transação)." });
    }

  } catch (error) {
    console.error("❌ Erro interno ao criar ação:", error);
    return res.status(500).json({ error: "Erro ao criar ação" });
  }
};

export default handler;
