// smmsociais.com/api/criar_acao.js

import connectDB from "./db.js";
import { User, Action } from "./schema.js";
import mongoose from "mongoose";
import axios from "axios";

const handler = async (req, res) => {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método não permitido" });

  try {
    await connectDB();

    // ---------------------------------------------
    // 🔐 VALIDAÇÃO DO HEADER AUTHORIZATION
    // ---------------------------------------------
    const auth = req.headers.authorization;
    const chaveEsperada = `Bearer ${process.env.SMM_API_KEY}`;

    if (!auth) return res.status(401).json({ error: "Não autorizado" });

    let usuario = null;
    let isInternal = false;

    // Chamada interna
    if (auth === chaveEsperada) {
      isInternal = true;
      console.log("🟣 Chamada interna autenticada via SMM_API_KEY");
    }
    // Chamada externa com token do usuário
    else if (auth.startsWith("Bearer ")) {
      const token = auth.split(" ")[1].trim();
      console.log("🔐 Token recebido:", token);

      usuario = await User.findOne({ token });

      if (!usuario) {
        console.warn("❌ Token não encontrado:", token);
        return res.status(401).json({ error: "Não autorizado" });
      }

      console.log("🧑‍💻 Usuário autenticado:", usuario.email);
    }
    else {
      return res.status(401).json({ error: "Não autorizado" });
    }

    // ---------------------------------------------
    // 📦 EXTRAÇÃO DO BODY
    // ---------------------------------------------
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

    if (isInternal) {
      if (!bodyUserId)
        return res.status(400).json({ error: "userId obrigatório" });

      usuario = await User.findById(bodyUserId);
      if (!usuario)
        return res.status(400).json({ error: "Usuário não encontrado" });

      console.log("🟣 Criando ação para usuário:", usuario.email);
    }

    // ---------------------------------------------
    // 🔍 VALIDAÇÕES
    // ---------------------------------------------
    if (!rede || !tipo || !nome || !valor || !quantidade || !link)
      return res.status(400).json({ error: "Dados incompletos" });

    if (id_servico && typeof id_servico !== "string")
      return res.status(400).json({ error: "id_servico inválido" });

    const valorNum = parseFloat(valor);
    const quantidadeNum = parseInt(quantidade);

    if (isNaN(valorNum) || valorNum <= 0)
      return res.status(400).json({ error: "Valor inválido" });

    if (
      !Number.isInteger(quantidadeNum) ||
      quantidadeNum < 50 ||
      quantidadeNum > 1000000
    )
      return res.status(400).json({
        error: "A quantidade deve ser um número entre 50 e 1.000.000!"
      });

    console.log("📌 Dados validados:");
    console.log("   ➤ Valor unitário:", valorNum);
    console.log("   ➤ Quantidade:", quantidadeNum);

    // ---------------------------------------------
    // 🔄 TRANSAÇÃO
    // ---------------------------------------------
    const session = await mongoose.startSession();

    try {
      session.startTransaction();

      console.log("💳 Saldo antes:", usuario.saldo);

      const custoTotal = valorNum; // DESCONTO UNITÁRIO
      console.log("💰 Debitando:", custoTotal);

      // Criar a Action
      const novaAcao = await Action.create(
        [
          {
            userId: usuario._id,
            id_servico,
            rede,
            tipo,
            nome,
            valor: valorNum,
            quantidade: quantidadeNum,
            validadas: 0,
            link,
            status: "pendente",
            dataCriacao: new Date()
          }
        ],
        { session, validateBeforeSave: true }
      );

      const acao = novaAcao[0];

      // Debitar saldo
      const debito = await User.updateOne(
        { _id: usuario._id, saldo: { $gte: custoTotal } },
        { $inc: { saldo: -custoTotal } },
        { session }
      );

      if (debito.modifiedCount === 0) {
        console.warn("❌ Saldo insuficiente");
        await session.abortTransaction();
        return res.status(402).json({ error: "Saldo insuficiente" });
      }

      await session.commitTransaction();

      const id_pedido = acao._id.toString();

      const usuarioAtual = await User.findById(usuario._id);

      console.log("💳 Saldo final:", usuarioAtual.saldo);

      // --------------------------------------------------------------------
      // 📤 ENVIO PARA GANHESOCIAL (ASSÍNCRONO + BLINDADO)
      // --------------------------------------------------------------------
      enviarParaGanheSocial({
        tipo_acao:
          tipo.toLowerCase() === "seguidores"
            ? "Seguir"
            : tipo.toLowerCase() === "curtidas"
            ? "Curtir"
            : "Outro",
        nome_usuario: link.includes("@")
          ? link.split("@")[1]
          : link.replace("https://", "").split("/")[0],
        quantidade_pontos: +(valorNum * 0.001).toFixed(6),
        quantidade: quantidadeNum,
        valor: valorNum,
        url_dir: link,
        id_pedido
      });

      // Resposta OK
      return res.status(201).json({
        message: "Ação criada com sucesso",
        id_pedido,
        newSaldo: usuarioAtual.saldo
      });
    } catch (err) {
      await session.abortTransaction();
      console.error("❌ Erro transação:", err);
      return res.status(500).json({ error: "Erro ao criar ação" });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("❌ Erro geral:", error);
    return res.status(500).json({ error: "Erro interno ao criar ação" });
  }
};

export default handler;

/* ============================================================
   🔥 Função separada para envio ao ganhesocial
   Blindado + retry + headers reais + logs clean
   ============================================================ */
async function enviarParaGanheSocial(payload) {
  const url = "https://ganhesocialtest.com/api/smm_acao";

  console.log("📤 Enviando para GanheSocial:", payload);

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await axios.post(url, payload, {
        timeout: 15000,
        headers: {
          Authorization: `Bearer ${process.env.SMM_API_KEY}`,
          "Content-Type": "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122"
        }
      });

      console.log("📩 Resposta GS:", res.data);
      return;
    } catch (e) {
      console.error(`⚠ Tentativa ${attempt}/3 falhou:`, e.message);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.error("❌ Falha ao enviar ação ao GanheSocial após 3 tentativas");
}
