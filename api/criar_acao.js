//smmsociais.com/api/criar_acao.js

import connectDB from "./db.js";
import { User, Action } from './schema.js';
import mongoose from "mongoose";

const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    await connectDB();

    const { authorization } = req.headers || {};
    const chaveEsperada = `Bearer ${process.env.SMM_API_KEY}`;

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

    // Se é chamada interna → buscar usuário pelo userId
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

    // Validações
    if (id_servico && typeof id_servico !== "string") {
      return res.status(400).json({ error: "id_servico inválido" });
    }

    const valorNum = parseFloat(valor);
    const quantidadeNum = Number(quantidade);

    if (isNaN(valorNum) || valorNum <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    if (!Number.isInteger(quantidadeNum) || quantidadeNum < 50 || quantidadeNum > 1000000) {
      return res.status(400).json({ error: "A quantidade deve ser um número entre 50 e 1.000.000!" });
    }

console.log("📌 Dados recebidos:");
console.log("   ➤ Valor unitário:", valorNum);
console.log("   ➤ Quantidade:", quantidadeNum);

// INICIAR TRANSAÇÃO
const session = await mongoose.startSession();

try {
  session.startTransaction();

  console.log("💳 Saldo do usuário (antes do débito):", usuario.saldo);

  // *** MUDANÇA IMPORTANTE ***
  // AGORA DEBITA APENAS O VALOR UNITÁRIO
  const custoTotal = valorNum;
  console.log("💰 Valor debitado (unitário):", custoTotal);

  // Criar a action
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

  // TENTAR DEBITAR APENAS O VALOR UNITÁRIO
  console.log("🧮 Tentando debitar...");

  const debitResult = await User.updateOne(
    { _id: usuario._id, saldo: { $gte: custoTotal } },
    { $inc: { saldo: -custoTotal } },
    { session }
  );

  console.log("📊 Resultado do débito:", debitResult);

  if (
    (debitResult.modifiedCount !== undefined && debitResult.modifiedCount === 0) ||
    (debitResult.nModified !== undefined && debitResult.nModified === 0)
  ) {
    console.warn("❌ O débito não foi aplicado (saldo insuficiente)");
    await session.abortTransaction();
    session.endSession();
    return res.status(402).json({ error: "Saldo insuficiente" });
  }

      await session.commitTransaction();
      session.endSession();

      const id_pedido = novaAcao._id.toString();
      console.log("🆔 Ação criada com ID:", id_pedido);

      // SALDO ATUALIZADO
      const usuarioAtualizado = await User.findById(usuario._id).select("saldo");
      console.log("💳 Saldo após o débito:", usuarioAtualizado.saldo);

      // Enviar ação para ganhesocial (assíncrono)
      const nome_usuario = (link && link.includes("@")) ? link.split("@")[1].trim() : (link ? link.trim() : '');
      const quantidade_pontos = +(valorNum * 0.001).toFixed(6);

      let tipo_acao = "Outro";
      const tipoLower = (tipo || "").toLowerCase();
      if (tipoLower === "seguidores") tipo_acao = "Seguir";
      else if (tipoLower === "curtidas") tipo_acao = "Curtir";

      const payloadGanheSocial = {
        tipo_acao,
        nome_usuario,
        quantidade_pontos,
        quantidade: quantidadeNum,
        valor: valorNum,
        url_dir: link,
        id_pedido,
      };

(async () => {
  const targetUrl = "https://ganhesocialtest.com/api/smm_acao";
  const payload = payloadGanheSocial; // já criado acima
  console.log("📤 Enviando ação para ganhesocial ->", targetUrl);
  console.log("📤 Payload:", JSON.stringify(payload));

  const controller = new AbortController();
  const timeoutMs = 10000; // 10s
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // mostra os headers que irá enviar
    const reqOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SMM_API_KEY}`,
        "User-Agent": "SMM-Sociais-Server"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    };
    console.log("📤 Request options:", { headers: reqOptions.headers, timeoutMs });

    const response = await fetch(targetUrl, reqOptions);
    clearTimeout(timeout);

    console.log("📩 Resposta recebida:", response.status, response.statusText);

    // tenta ler texto primeiro (sempre seguro)
    const raw = await response.text().catch((e) => {
      console.error("❗ Falha ao ler response.text():", e);
      return null;
    });

    // mostra cabeçalhos da resposta (útil)
    try {
      const respHeaders = {};
      response.headers.forEach((v, k) => { respHeaders[k] = v; });
      console.log("📩 Response headers:", respHeaders);
    } catch (e) {
      // ignore
    }

    // tenta parse JSON, se falhar mostra raw
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
      console.log("📩 JSON:", data);
    } catch (errParse) {
      console.warn("⚠️ Resposta não-JSON. raw:", raw);
    }

    if (!response.ok) {
      console.error("⚠️ Erro na resposta do ganhesocial:", response.status, data || raw);
    } else {
      console.log("✅ Ação registrada no ganhesocial (ok):", data);
      // se receber id_acao_smm, atualiza action (se quiser)
      if (data && data.id_acao_smm) {
        try {
          await Action.findByIdAndUpdate(id_pedido, { id_acao_smm: data.id_acao_smm });
          console.log("🔁 Action atualizado com id_acao_smm:", data.id_acao_smm);
        } catch (errUpdate) {
          console.error("❌ Falha ao atualizar Action com id_acao_smm:", errUpdate);
        }
      }
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      console.error("❌ ERRO FETCH: Abort devido a timeout (" + timeoutMs + "ms)");
    } else {
      console.error("❌ ERRO FETCH:", err && err.message ? err.message : err);
    }
  }
})();

      return res.status(201).json({
        message: "Ação criada com sucesso",
        id_pedido,
        newSaldo: usuarioAtualizado.saldo
      });

    } catch (txErr) {
      try {
        await session.abortTransaction();
      } catch(e2) { console.error("Erro abortando transação:", e2); }

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
