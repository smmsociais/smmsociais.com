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
    } else if (authorization.startsWith('Bearer ')) {
      const token = authorization.split(' ')[1].trim();
      console.log("🔐 Token recebido (criar_acao):", token);
      usuario = await User.findOne({ token });
      if (!usuario) {
        console.warn("🔒 Token de usuário não encontrado:", token);
        return res.status(401).json({ error: "Não autorizado" });
      }
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

    // Se é chamada interna, espera userId no body
    if (isInternalCall) {
      if (!bodyUserId) {
        return res.status(400).json({ error: "userId obrigatório para chamadas internas" });
      }
      usuario = await User.findById(String(bodyUserId));
      if (!usuario) {
        return res.status(400).json({ error: "Usuário não encontrado!" });
      }
    }

    // validações
    if (id_servico && typeof id_servico !== "string") {
      return res.status(400).json({ error: "id_servico inválido" });
    }

    const valorNum = parseFloat(valor);
    if (isNaN(valorNum) || valorNum <= 0) {
      return res.status(400).json({ error: "Valor inválido" });
    }

    const quantidadeNum = Number(quantidade);
    if (!Number.isInteger(quantidadeNum) || quantidadeNum < 50 || quantidadeNum > 1000000) {
      return res.status(400).json({ error: "A quantidade deve ser um número entre 50 e 1.000.000!" });
    }

    // ===== ATÔMICO: tentar debitar saldo do usuário =====
    // Filter garante que apenas decrementamos se saldo >= valorNum
    const debitResult = await User.updateOne(
      { _id: usuario._id, saldo: { $gte: valorNum } },
      { $inc: { saldo: -valorNum } }
    );

    if (!debitResult.matchedCount || debitResult.matchedCount === 0) {
      // saldo insuficiente (nenhum documento correspondido)
      return res.status(402).json({ error: "Saldo insuficiente" });
    }

    // buscar usuário atualizado para retornar novo saldo
    const usuarioAtualizado = await User.findById(usuario._id).select('saldo');

    // Criar a ação (agora que o débito já foi aplicado)
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

    try {
      await novaAcao.save();
    } catch (errSave) {
      // rollback: credita de volta o valor
      console.error("❌ Falha ao salvar ação, efetuando rollback do débito:", errSave);
      await User.updateOne({ _id: usuario._id }, { $inc: { saldo: valorNum } });
      return res.status(500).json({ error: "Erro ao criar ação. Saldo reembolsado automaticamente." });
    }

    const id_pedido = novaAcao._id.toString();

    // Envia para ganhesocial (não precisa bloquear a resposta para o usuário se preferir)
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

    console.log("➡️ Enviando para ganhesocial.com:", payloadGanheSocial);

    try {
      const response = await fetch("https://ganhesocial.com/api/smm_acao", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: chaveEsperada
        },
        body: JSON.stringify(payloadGanheSocial)
      });

      const data = await response.json().catch(()=>null);

      if (!response.ok) {
        console.error("⚠️ Erro na resposta do ganhesocial:", response.status, data);
      } else {
        console.log("✅ Ação registrada no ganhesocial:", data);
        if (data && data.id_acao_smm) {
          await Action.findByIdAndUpdate(novaAcao._id, { id_acao_smm: data.id_acao_smm });
        }
      }
    } catch (erroEnvio) {
      console.error("❌ Falha na comunicação com ganhesocial:", erroEnvio);
    }

    // Retorna novo saldo para o frontend atualizar UI imediatamente
    return res.status(201).json({
      message: "Ação criada com sucesso",
      id_pedido,
      newSaldo: usuarioAtualizado.saldo
    });

  } catch (error) {
    console.error("❌ Erro interno ao criar ação:", error);
    return res.status(500).json({ error: "Erro ao criar ação" });
  }
};

export default handler;
