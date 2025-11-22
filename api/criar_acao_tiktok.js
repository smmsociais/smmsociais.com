// /api/criar_acao_tiktok.js
import connectDB from "./db.js";
import { User, Action } from './schema.js';
import mongoose from "mongoose";
import axios from "axios";

const SMM_API_KEY = process.env.SMM_API_KEY;
const GANHESOCIAL_URL = process.env.GANHESOCIAL_URL || "https://ganhesocialtest.com/api/smm_acao";
const SEND_TIMEOUT_MS = process.env.SEND_TIMEOUT_MS ? Number(process.env.SEND_TIMEOUT_MS) : 10000;
const RAPIDAPI_TIMEOUT_MS = process.env.RAPIDAPI_TIMEOUT_MS ? Number(process.env.RAPIDAPI_TIMEOUT_MS) : 8000;

// RapidAPI keys
const SCRAPTIK_KEY = process.env.SCRAPTIK_KEY || process.env.RAPIDAPI_KEY || process.env.RAPIDAPI || process.env.rapidapi_key || "";
const INSTAGRAM_RAPIDAPI_KEY = process.env.INSTAGRAM_RAPIDAPI_KEY || SCRAPTIK_KEY;

// cache global simples por processo
global.__rapidapi_cache__ = global.__rapidapi_cache__ || new Map();
const rapidapiCache = global.__rapidapi_cache__;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// extrai username de link/nomes variados
function extractUsernameFromLink(link) {
  if (!link || typeof link !== "string") return null;
  let s = link.trim();
  s = s.split("?")[0].split("#")[0];
  // @user
  const atMatch = s.match(/@([A-Za-z0-9._-]+)/);
  if (atMatch && atMatch[1]) return atMatch[1];
  // tiktok.com/@user or instagram.com/user
  const m = s.match(/(?:tiktok\.com\/(?:@)?|instagram\.com\/(?:@)?)([^\/?#&]+)/i);
  if (m && m[1]) return m[1].replace(/\/$/, "");
  // fallback: último segmento
  s = s.replace(/\/+$/, "");
  const parts = s.split("/");
  const last = parts[parts.length - 1] || "";
  if (last.length > 0) return last.replace(/^@/, "");
  return null;
}

// fetcher Scraptik (TikTok) retorna objeto ou null
async function fetchTikTokUser(username) {
  if (!username) return null;
  const cacheKey = `tiktok:${username.toLowerCase()}`;
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

// fetcher Instagram Social API retorna objeto ou null
async function fetchInstagramUser(username) {
  if (!username) return null;
  const cacheKey = `instagram:${username.toLowerCase()}`;
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

// obtém contagem inicial (number|null) baseado na rede/link
async function getInitialCount(rede, link) {
  try {
    const username = extractUsernameFromLink(link || "");
    if (!username) {
      console.log("[contagemInicial] Username não extraído de link:", link);
      return null;
    }

    // Tenta Scraptik primeiro (índice preferencial para TikTok)
    if (String(rede || "").toLowerCase() === "tiktok") {
      const info = await fetchTikTokUser(username);
      const count = info?.user?.follower_count ?? info?.user?.followerCount ?? null;
      const normalized = Number.isFinite(Number(count)) ? Number(count) : null;
      console.log(`[contagemInicial][tiktok] ${username} =>`, normalized);
      return normalized;
    }

    // Para Instagram, tentar a API do instagram-social-api
    if (String(rede || "").toLowerCase() === "instagram") {
      const info = await fetchInstagramUser(username);
      // a API retorna em data: {...} ou diretamente; tenta vários caminhos
      const maybe = info?.data ?? info;
      const count = maybe?.follower_count ?? maybe?.followerCount ?? maybe?.followers ?? null;
      const normalized = Number.isFinite(Number(count)) ? Number(count) : null;
      console.log(`[contagemInicial][instagram] ${username} =>`, normalized);
      return normalized;
    }

    // fallback: tentar Scraptik genérico
    const fallback = await fetchTikTokUser(username);
    const count = fallback?.user?.follower_count ?? fallback?.user?.followerCount ?? null;
    const normalized = Number.isFinite(Number(count)) ? Number(count) : null;
    console.log(`[contagemInicial][fallback] ${username} =>`, normalized);
    return normalized;
  } catch (e) {
    console.warn("Erro em getInitialCount:", e?.message || e);
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

    // tenta obter contagem inicial (não bloqueante: mas aqui vamos aguardar para gravar no documento)
    let contagemInicial = null;
    try {
      contagemInicial = await getInitialCount(rede, link || nome || "");
      // contagemInicial pode ser number ou null
      console.log("📥 contagemInicial obtida:", contagemInicial);
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
          // inclui contagemInicial no meta enviado ao ganhesocial (útil)
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
