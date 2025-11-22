// /api/criar_acao_tiktok.js
import connectDB from "./db.js";
import { User, Action } from './schema.js';
import mongoose from "mongoose";
import axios from "axios";

const SMM_API_KEY = process.env.SMM_API_KEY;
const GANHESOCIAL_URL = process.env.GANHESOCIAL_URL || "https://ganhesocialtest.com/api/smm_acao";
const SEND_TIMEOUT_MS = process.env.SEND_TIMEOUT_MS ? Number(process.env.SEND_TIMEOUT_MS) : 10000;
const RAPIDAPI_TIMEOUT_MS = process.env.RAPIDAPI_TIMEOUT_MS ? Number(process.env.RAPIDAPI_TIMEOUT_MS) : 8000;

// RapidAPI keys (tenta nomes diferentes de env)
const SCRAPTIK_KEY = process.env.SCRAPTIK_KEY || process.env.RAPIDAPI_KEY || process.env.RAPIDAPI || process.env.rapidapi_key || "";
const INSTAGRAM_RAPIDAPI_KEY = process.env.INSTAGRAM_RAPIDAPI_KEY || SCRAPTIK_KEY;

// cache global simples por processo (evita flood em chamadas rápidas)
global.__rapidapi_cache__ = global.__rapidapi_cache__ || new Map();
const rapidapiCache = global.__rapidapi_cache__;

// util: sleep
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// util: extrair username de vários formatos (instagram/tiktok)
function extractUsernameFromLink(link) {
  if (!link || typeof link !== "string") return null;
  let s = link.trim();
  // remove query/hash
  s = s.split("?")[0].split("#")[0];
  // se contém @username
  const atMatch = s.match(/@([A-Za-z0-9._-]+)/);
  if (atMatch && atMatch[1]) return atMatch[1];
  // tentar extrair depois de domain/ (instagram.com/username, tiktok.com/@username)
  const m = s.match(/(?:instagram\.com|tiktok\.com)\/(?:@?([^\/?#&]+))/i);
  if (m && m[1]) return m[1].replace(/\/$/, "");
  // fallback: último segmento
  s = s.replace(/\/+$/, "");
  const parts = s.split("/");
  const last = parts[parts.length - 1] || "";
  if (last.length > 0) return last.replace(/^@/, "");
  return null;
}

// fetcher para Scraptik (TikTok)
async function fetchTikTokUser(username) {
  if (!username) return null;
  const cacheKey = `tiktok:${username.toLowerCase()}`;
  const cached = rapidapiCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < (60 * 1000)) return cached.data; // 60s cache

  if (!SCRAPTIK_KEY) {
    // sem chave, não tente
    rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
    return null;
  }

  const url = "https://scraptik.p.rapidapi.com/get-user";
  const axiosCfg = {
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
      const resp = await axios(axiosCfg);
      const data = resp?.data ?? null;
      rapidapiCache.set(cacheKey, { data, fetchedAt: Date.now() });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // 400/404 -> não retry
      if (status === 400 || status === 404) {
        rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
        return null;
      }
      // backoff leve
      await sleep(150 * attempt);
    }
  }
  console.warn("fetchTikTokUser final error for", username, lastErr?.message || lastErr);
  rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
  return null;
}

// fetcher para Instagram Social API
async function fetchInstagramUser(username) {
  if (!username) return null;
  const cacheKey = `instagram:${username.toLowerCase()}`;
  const cached = rapidapiCache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < (60 * 1000)) return cached.data; // 60s cache

  if (!INSTAGRAM_RAPIDAPI_KEY) {
    rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
    return null;
  }

  const url = "https://instagram-social-api.p.rapidapi.com/v1/info";
  const axiosCfg = {
    method: "get",
    url,
    params: { username_or_id_or_url: username },
    headers: {
      "x-rapidapi-key": INSTAGRAM_RAPIDAPI_KEY,
      "x-rapidapi-host": "instagram-social-api.p.rapidapi.com"
    },
    timeout: RAPIDAPI_TIMEOUT_MS
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const resp = await axios(axiosCfg);
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
  console.warn("fetchInstagramUser final error for", username, lastErr?.message || lastErr);
  rapidapiCache.set(cacheKey, { data: null, fetchedAt: Date.now() });
  return null;
}

// enviar para ganhesocial (mantido da sua versão)
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
      console.log("🔐 Token recebido (criar_acao):", token);

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

    // tenta enriquecer com dados do RapidAPI (tiktok / instagram) - não é obrigatório
    let providerData = null;
    try {
      const username = extractUsernameFromLink(link || nome || "");
      if (username && (String(rede || "").toLowerCase() === "tiktok")) {
        console.log("🔎 Tentando buscar dados TikTok via Scraptik para:", username);
        const info = await fetchTikTokUser(username);
        if (info) {
          providerData = { provider: "scraptik", user: info.user ?? info };
          console.log("✅ Scraptik info found:", providerData.user?.unique_id ?? providerData.user?.secUid ?? providerData.user?.follower_count);
        } else {
          console.log("⚠ Scraptik: sem dados para", username);
        }
      } else if (username && (String(rede || "").toLowerCase() === "instagram")) {
        console.log("🔎 Tentando buscar dados Instagram via RapidAPI para:", username);
        const info = await fetchInstagramUser(username);
        if (info) {
          // API retorna .data e dentro .data.username etc
          providerData = { provider: "instagram_social_api", user: info.data ?? info };
          console.log("✅ Instagram info found:", providerData.user?.username ?? providerData.user?.profile_pic_url_hd);
        } else {
          console.log("⚠ Instagram API: sem dados para", username);
        }
      }
    } catch (e) {
      console.warn("⚠ Erro ao buscar dados RapidAPI (não bloqueante):", e?.message || e);
      providerData = providerData ?? null;
    }

    // Inicia sessão / transação
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      console.log("💳 Saldo do usuário (antes do débito):", usuario.saldo);

      // débito APENAS do valor unitário
      const custoATerDebitado = valorNum;
      console.log("💰 Valor que será debitado (unitário):", custoATerDebitado);

      // Criar a action (na transação)
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
        dataCriacao: new Date()
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
          provider_data: providerData // pode ser null
        }
      };

      // Envia para ganhesocial e tenta atualizar id_acao_smm
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
        newSaldo: usuarioAtualizado ? usuarioAtualizado.saldo : null
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
