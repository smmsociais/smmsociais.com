import axios from "axios";
import connectDB from "./db.js";
import mongoose from "mongoose";
import { sendRecoveryEmail } from "./mailer.js";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { User, Deposito, Action, ActionHistory, Servico, Message } from "./schema.js";

export default async function handler(req, res) {
    await connectDB(); // 🟢 Conectar ao banco antes de qualquer operação

    const { method, url } = req;

    // ✅ Rota: /api/buscar_acao_disponivel (POST)
    if (url.startsWith("/api/buscar_acao_disponivel") && method === "POST") {
        try {
            const { id } = req.query;

            if (id) {
                const acao = await Action.findById(id);
                if (!acao) {
                    return res.status(404).json({ status: 'NAO_ENCONTRADA', message: 'Ação com esse ID não foi encontrada.' });
                }

                const execucoes = await ActionHistory.countDocuments({
                    id_pedido: acao._id,
                    acao_validada: { $in: [null, true, "true"] }
                });

                if (execucoes >= acao.quantidade) {
                    return res.status(403).json({ status: 'LIMITE_ATINGIDO', message: 'Limite de execuções já atingido para esta ação.' });
                }

                return res.json({
                    status: 'ENCONTRADA',
                    _id: acao._id,
                    userId: acao.userId,
                    rede: acao.rede,
                    tipo: acao.tipo,
                    nome: acao.nome,
                    valor: acao.valor,
                    quantidade: acao.quantidade,
                    quantidadeExecutada: execucoes,
                    link: acao.link,
                    dataCriacao: acao.dataCriacao
                });
            }

            // 🔁 Buscar primeira ação pendente válida
            const acoesPendentes = await Action.find({ status: 'pendente' }).sort({ dataCriacao: 1 });

            for (const acao of acoesPendentes) {
                const execucoes = await ActionHistory.countDocuments({
                    id_pedido: acao._id,
                    acao_validada: { $in: [null, true, "true"] }
                });

                if (execucoes < acao.quantidade) {
                    return res.json({
                        status: 'ENCONTRADA',
                        _id: acao._id,
                        userId: acao.userId,
                        rede: acao.rede,
                        tipo: acao.tipo,
                        nome: acao.nome,
                        valor: acao.valor,
                        quantidade: acao.quantidade,
                        quantidadeExecutada: execucoes,
                        link: acao.link,
                        dataCriacao: acao.dataCriacao
                    });
                }
            }

            return res.json({ status: 'NAO_ENCONTRADA' });

        } catch (error) {
            console.error('Erro ao buscar ação disponível:', error);
            return res.status(500).json({ error: 'Erro interno' });
        }
    }

    // ✅ Rota: /api/login (POST)
    if (url.startsWith("/api/login") && method === "POST") {
        try {
            const { email, senha } = req.body;

            if (!email || !senha) {
                return res.status(400).json({ error: "E-mail e senha são obrigatórios!" });
            }

            const usuario = await User.findOne({ email });

            if (!usuario) {
                console.log("🔴 Usuário não encontrado!");
                return res.status(400).json({ error: "Usuário não encontrado!" });
            }

            if (senha !== usuario.senha) {
                console.log("🔴 Senha incorreta!");
                return res.status(400).json({ error: "Senha incorreta!" });
            }

            let token = usuario.token;
            if (!token) {
                token = jwt.sign({ id: usuario._id }, process.env.JWT_SECRET);
                usuario.token = token;
                await usuario.save({ validateBeforeSave: false });

                console.log("🟢 Novo token gerado e salvo.");
            } else {
                console.log("🟢 Token já existente mantido.");
            }

            console.log("🔹 Token gerado para usuário:", token);
            return res.json({ message: "Login bem-sucedido!", token });

        } catch (error) {
            console.error("❌ Erro ao realizar login:", error);
            return res.status(500).json({ error: "Erro ao realizar login" });
        }
    }

// Rota: /api/signup
if (url.startsWith("/api/signup")) {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Método não permitido." });
    }

    await connectDB();

    const { email, senha } = req.body;

    if (!email || !senha) {
        return res.status(400).json({ error: "Todos os campos são obrigatórios." });
    }

    try {

        const emailExiste = await User.findOne({ email });
        if (emailExiste) {
            return res.status(400).json({ error: "E-mail já está cadastrado." });
        }

        // Gerar token único
        const token = crypto.randomBytes(32).toString("hex");

        const novoUsuario = new User({ email, senha, token });
        await novoUsuario.save();

        return res.status(201).json({ message: "Usuário registrado com sucesso!", token });
    } catch (error) {
        console.error("Erro ao cadastrar usuário:", error);
        return res.status(500).json({ error: "Erro interno ao registrar usuário. Tente novamente mais tarde." });
    }
};

// Rota: /api/account (GET ou PUT)
if (url.startsWith("/api/account")) {
  if (method !== "GET" && method !== "PUT") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  await connectDB();

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  const token = authHeader.split(" ")[1].trim();
  console.log("🔐 Token recebido:", token);

  try {
    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }
 
    if (method === "GET") {
      let actionHistory = null;

      if (usuario.historico_acoes?.length > 0) {
        actionHistory = await ActionHistory.findOne({
          _id: { $in: usuario.historico_acoes }
        }).sort({ data: -1 });
      }

// dentro do bloco if (method === "GET") { ... }
return res.status(200).json({
  nome_usuario: usuario.nome,
  email: usuario.email,
  token: usuario.token,
  userId: usuario._id ? String(usuario._id) : null, // <-- adiciona userId
  id: usuario._id ? String(usuario._id) : null      // <-- alias opcional
});
    }

    if (method === "PUT") {
      const { nome_usuario, email, senha } = req.body;

      const updateFields = { nome: nome_usuario, email };
      if (senha) {
        updateFields.senha = senha; // ⚠️ Criptografar se necessário
      }

      const usuarioAtualizado = await User.findOneAndUpdate(
        { token },
        updateFields,
        { new: true }
      );

      if (!usuarioAtualizado) {
        return res.status(404).json({ error: "Usuário não encontrado." });
      }

      return res.status(200).json({ message: "Perfil atualizado com sucesso!" });
    }
  } catch (error) {
    console.error("💥 Erro ao processar /account:", error);
    return res.status(500).json({ error: "Erro ao processar perfil." });
  }
}

// Rota: /api/massorder
if (url.startsWith("/api/massorder")) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    await connectDB();

    // 🔐 Validação da chave da API
    const { authorization } = req.headers;
    const chaveEsperada = `Bearer ${process.env.SMM_API_KEY}`;

    if (!authorization || authorization !== chaveEsperada) {
      console.warn("🔒 Chave inválida:", authorization);
      return res.status(401).json({ error: "Não autorizado" });
    }

    const { pedidos } = req.body;

    if (!Array.isArray(pedidos) || pedidos.length === 0) {
      return res.status(400).json({ error: "Nenhum pedido enviado." });
    }

    const resultados = [];

    for (const pedido of pedidos) {
      const { rede, tipo, nome, quantidade, link } = pedido;

      // ✅ Validação básica
      if (!rede || !tipo || !nome || !quantidade || !link) {
        resultados.push({ erro: "Campos ausentes no pedido", pedido });
        continue;
      }

      const quantidadeNum = Number(quantidade);

      if (!Number.isInteger(quantidadeNum) || quantidadeNum < 50 || quantidadeNum > 1000000) {
        resultados.push({ erro: "Quantidade fora do intervalo permitido", pedido });
        continue;
      }

      // 🆕 Criação da ação no MongoDB
      const novaAcao = new Action({
        rede,
        tipo,
        nome,
        quantidade: quantidadeNum,
        link,
        status: "pendente",
        dataCriacao: new Date()
      });

      await novaAcao.save();
      const id_pedido = novaAcao._id.toString();

      // 🔗 Preparar dados para envio ao ganhesocial.com
      const nome_usuario = link.includes("@") ? link.split("@")[1].trim() : link.trim();
      const quantidade_pontos = 0.007;

      let tipo_acao = "Outro";
      const tipoLower = tipo.toLowerCase();
      if (tipoLower === "seguidores") tipo_acao = "Seguir";
      else if (tipoLower === "curtidas") tipo_acao = "Curtir";

      const payloadGanheSocial = {
        tipo_acao,
        nome_usuario,
        quantidade_pontos,
        quantidade: quantidadeNum,
        url_dir: link,
        id_pedido,
        valor: 7
      };

      try {
        const response = await fetch("https://ganhesocial.com/api/smm_acao", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: chaveEsperada
          },
          body: JSON.stringify(payloadGanheSocial)
        });

        const data = await response.json();

        if (!response.ok) {
          console.error("⚠️ Erro ao enviar ação:", data);
          resultados.push({ erro: "Erro ao enviar ao ganhesocial", id_pedido, motivo: data });
        } else {
          resultados.push({ sucesso: true, id_pedido });
        }
      } catch (erroEnvio) {
        console.error("❌ Erro de rede:", erroEnvio);
        resultados.push({ erro: "Erro de rede ao enviar ao ganhesocial", id_pedido });
      }
    }

    return res.status(200).json({ resultados });

  } catch (error) {
    console.error("❌ Erro interno:", error);
    return res.status(500).json({ error: "Erro ao processar pedidos" });
  }
};

// Rota: /api/incrementar-validadas
if (url.startsWith("/api/incrementar-validadas")) {
  console.log("[incrementar-validadas] chamada recebida");
  console.log("Método:", req.method);
  console.log("Headers:", req.headers);

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  console.log("Corpo recebido (raw):", req.body);

  // 🔐 Autenticação
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("[incrementar-validadas] auth header ausente");
    return res.status(401).json({ error: "Chave ausente" });
  }

  const apiKey = String(authHeader).replace(/^Bearer\s+/i, "").trim();
  if (apiKey !== process.env.SMM_API_KEY) {
    console.warn("[incrementar-validadas] chave inválida");
    return res.status(403).json({ error: "Chave inválida" });
  }

  // 📌 Dados enviados
  let { id_acao_smm } = req.body || {};

  if (!id_acao_smm) {
    return res.status(400).json({ error: "id_acao_smm é obrigatório" });
  }

  const parsedID = Number(id_acao_smm);
  if (isNaN(parsedID)) {
    return res.status(400).json({ error: "id_acao_smm inválido" });
  }

  try {
    await connectDB();

    // ⬆ Incrementar validadas via Mongoose
    const updated = await Action.findOneAndUpdate(
      { id_acao_smm: parsedID },
      { $inc: { validadas: 1 } },
      { new: true } // retorna o documento atualizado
    );

    if (!updated) {
      return res.status(404).json({ error: "Ação não encontrada" });
    }

    // 🏁 Se atingiu o limite, marcar como completado
    if (updated.validadas >= updated.quantidade && updated.status !== "Concluído") {
      updated.status = "Concluído";
      await updated.save();
      console.log("[incrementar-validadas] ação marcada como COMPLETADA");
    }

    console.log("[incrementar-validadas] SUCESSO:", {
      id_acao_smm: parsedID,
      validadas: updated.validadas
    });

    return res.status(200).json({
      status: "ok",
      id_acao_smm: parsedID,
      novas_validadas: updated.validadas,
      status_acao: updated.status
    });

  } catch (err) {
    console.error("[incrementar-validadas] erro:", err);
    return res.status(500).json({
      error: "Erro interno no servidor",
      details: String(err.message || err)
    });
  }
}

// Rota: /api/orders
if (url.startsWith("/api/orders")) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    await connectDB();

    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token não fornecido" });
    }

    const token = authorization.split(" ")[1];
    const usuario = await User.findOne({ token });

    if (!usuario) {
      return res.status(401).json({ error: "Token inválido ou usuário não encontrado!" });
    }

    // 🔄 Atualizar status automaticamente
    await Action.updateMany(
      { status: "pendente", validadas: { $gt: 0 } },
      { $set: { status: "progress" } }
    );

    await Action.updateMany(
      { status: { $in: ["pendente", "progress"] }, $expr: { $eq: ["$validadas", "$quantidade"] } },
      { $set: { status: "completed" } }
    );

    // ---------- Helpers locais ----------
    function extractUsernameFromUrl(urlDir) {
      if (!urlDir || typeof urlDir !== "string") return null;
      let s = urlDir.replace(/[\r\n]/g, "").trim();
      s = s.split("?")[0].split("#")[0];
      const m = s.match(/@([A-Za-z0-9_.-]+)/);
      if (m && m[1]) return m[1].toLowerCase();
      s = s.replace(/^\/+|\/+$/g, "");
      if (s.includes("/")) {
        const parts = s.split("/");
        s = parts[parts.length - 1];
      }
      if (s.startsWith("@")) s = s.slice(1);
      s = s.trim().toLowerCase();
      return s === "" ? null : s;
    }

    // Scraptik helper com cache simples e retry
    const SCRAPTIK_KEY = process.env.RAPIDAPI_KEY || process.env.RAPIDAPI || "";
    // manter cache no global para reuso entre requests no mesmo processo
    const scraptikCache = global.__scraptik_cache__ || new Map();
    global.__scraptik_cache__ = scraptikCache;
    const SCRAPTIK_CACHE_TTL = 60 * 1000; // 60s (ajuste se necessário)
    const SCRAPTIK_TIMEOUT_MS = 10000;

    async function fetchFollowerCount(username) {
      if (!username) return null;

      const cached = scraptikCache.get(username);
      if (cached && (Date.now() - cached.fetchedAt) < SCRAPTIK_CACHE_TTL) {
        return cached.count;
      }

      if (!SCRAPTIK_KEY) {
        console.warn("SCRAPTIK_KEY não definido — não será possível buscar contagem de seguidores.");
        scraptikCache.set(username, { count: null, fetchedAt: Date.now() });
        return null;
      }

      const axiosConfig = {
        method: "get",
        url: "https://scraptik.p.rapidapi.com/get-user",
        params: { username },
        headers: {
          "x-rapidapi-key": SCRAPTIK_KEY,
          "x-rapidapi-host": "scraptik.p.rapidapi.com"
        },
        timeout: SCRAPTIK_TIMEOUT_MS
      };

      let lastErr = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const resp = await axios(axiosConfig);
          const data = resp?.data;
          const count = Number(data?.user?.follower_count ?? data?.user?.followerCount ?? null);
          const normalized = Number.isFinite(count) ? count : null;
          scraptikCache.set(username, { count: normalized, fetchedAt: Date.now() });
          return normalized;
        } catch (err) {
          lastErr = err;
          const status = err?.response?.status;
          // se 400 ou 404, é non-retryable (usuário privado ou inexistente)
          if (status === 400 || status === 404) {
            console.warn(`scraptik get-user: non-retryable for ${username} ->`, err?.response?.data || err.message);
            scraptikCache.set(username, { count: null, fetchedAt: Date.now() });
            return null;
          }
          console.warn(`scraptik get-user falhou (tentativa ${attempt}) para ${username}:`, err.message || status || err);
          await new Promise(r => setTimeout(r, 200 * attempt));
        }
      }
      console.error("scraptik get-user erro final:", lastErr?.message || lastErr);
      scraptikCache.set(username, { count: null, fetchedAt: Date.now() });
      return null;
    }

    // ---------- Buscar ações e serviços ----------
    const statusQuery = req.query.status;
    const filtro = { userId: usuario._id };

    if (statusQuery && statusQuery !== "todos") {
      if (statusQuery === "pending") {
        filtro.validadas = 0;
      } else if (statusQuery === "progress") {
        filtro.validadas = { $gt: 0 };
        filtro.status = "progress";
      } else {
        filtro.status = statusQuery;
      }
    }

    const acoes = await Action.find(filtro).sort({ dataCriacao: -1 });

    const idsServico = [...new Set(acoes.map(a => a.id_servico))].filter(Boolean);
    const servicos = idsServico.length > 0 ? await Servico.find({ id_servico: { $in: idsServico } }) : [];

    // ---------- Montar retorno com contagem inicial (e salvar no DB se ausente) ----------
    const CONCURRENCY = 5;
    const queue = [...acoes];
    const acoesComDetalhes = [];

    while (queue.length > 0) {
      const batch = queue.splice(0, CONCURRENCY);
      const promises = batch.map(async acao => {
        const obj = acao.toObject();
        obj.id = obj.id_acao_smm || obj._id.toString();
        obj.servicoDetalhes = servicos.find(s => s.id_servico === obj.id_servico) || null;

        // Se contagemInicial já está no documento (não nulo/undefined), reutiliza sem chamar Scraptik
        if (obj.contagemInicial !== undefined && obj.contagemInicial !== null) {
          // já tem valor no DB -> só garante que seja número inteiro (fallback)
          obj.contagemInicial = Number.isFinite(Number(obj.contagemInicial)) ? Number(obj.contagemInicial) : 0;
          return obj;
        }

        // extrair username do link
        const username = extractUsernameFromUrl(obj.link || obj.url || "");
        if (!username) {
          obj.contagemInicial = 0;
          // grava contagemInicial 0 no documento (somente se ainda não existir)
          try {
            await Action.updateOne(
              { _id: acao._id, $or: [{ contagemInicial: { $exists: false } }, { contagemInicial: null }] },
              { $set: { contagemInicial: 0 } }
            );
          } catch (e) {
            console.warn("Falha ao gravar contagemInicial=0 para action", acao._id, e?.message || e);
          }
          return obj;
        }

        // buscar follower_count (cache + retry)
        let count = null;
        try {
          count = await fetchFollowerCount(username);
        } catch (e) {
          console.warn("Erro ao buscar follower_count para", username, e?.message || e);
          count = null;
        }

        // normalizar (null ou número)
        const normalized = Number.isFinite(Number(count)) ? Number(count) : null;
        obj.contagemInicial = (normalized !== null) ? normalized : 0; // frontend espera número; pode ser 0 se não encontrado

        // salvar no documento actions apenas se não existir contagemInicial
        try {
          const filter = { _id: acao._id, $or: [{ contagemInicial: { $exists: false } }, { contagemInicial: null }] };
          const update = { $set: { contagemInicial: normalized } }; // grava `null` quando não encontrado, ou número
          const resUpdate = await Action.updateOne(filter, update);
          if (resUpdate.modifiedCount === 1) {
            console.log(`[orders] contagemInicial salva para action ${acao._id}:`, normalized);
          } else {
            // modifiedCount === 0 => outro processo gravou antes, ou já tinha valor
            if (resUpdate.matchedCount === 0) {
              // sem match — possivelmente id incorreto (não deveria acontecer)
              console.warn("[orders] update contagemInicial sem match para", acao._id);
            } else {
              // matched but not modified => contagemInicial já estava diferente
              console.log("[orders] contagemInicial já existente para", acao._id);
            }
          }
        } catch (e) {
          console.error("[orders] erro ao gravar contagemInicial no DB para", acao._id, e?.message || e);
        }

        // se normalized for null, deixamos obj.contagemInicial = 0 para exibição (frontend já faz fallback)
        obj.contagemInicial = (normalized !== null) ? normalized : 0;
        return obj;
      });

      const results = await Promise.all(promises);
      acoesComDetalhes.push(...results);

      if (queue.length > 0) await new Promise(r => setTimeout(r, 150));
    }

    // Retornar
    return res.json({ acoes: acoesComDetalhes });

  } catch (error) {
    console.error("Erro ao buscar histórico de ações:", error);
    return res.status(500).json({ error: "Erro ao buscar histórico de ações" });
  }
}

 // Rota: /api/recover-password
if (url.startsWith("/api/recover-password")) { 
  if (req.method !== "POST")
    return res.status(405).json({ error: "Método não permitido" });

  const { email } = req.body;
  if (!email)
    return res.status(400).json({ error: "Email é obrigatório" });

  try {
    await connectDB(); // só garante a conexão
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user)
      return res.status(404).json({ error: "Email não encontrado" });

    const token = crypto.randomBytes(32).toString("hex");
    
    const expires = Date.now() + 30 * 60 * 1000; // 30 minutos em milissegundos

    // Salva no documento Mongoose
    user.resetPasswordToken = token;
    user.resetPasswordExpires = new Date(expires);
    await user.save();

    const link = `https://smmsociais.com/reset-password?token=${token}`;
    await sendRecoveryEmail(email, link);

    return res.status(200).json({ message: "Link enviado com sucesso" });
  } catch (err) {
    console.error("Erro em recover-password:", err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
}

// Rota: /api/change-password
if (url.startsWith("/api/change-password")) {
        if (req.method !== "POST") {
            return res.status(405).json({ error: "Método não permitido" });
        }
    
        try {
            await connectDB();
            console.log("Conectado ao MongoDB via Mongoose");
    
            const authHeader = req.headers.authorization || "";
            console.log("📩 Cabeçalho Authorization recebido:", authHeader);
    
            const token = authHeader.replace("Bearer ", "").trim();
            console.log("🔐 Token extraído:", token);
    
            if (!token) {
                return res.status(401).json({ error: "Token ausente" });
            }
    
            // Buscar o usuário com o token
            const usuario = await User.findOne({ resetPasswordToken: token });
    
            if (!usuario) {
                console.log("❌ Token inválido ou usuário não encontrado!");
                return res.status(401).json({ error: "Token inválido" });
            }
    
            // (Opcional) Validar se o token expirou
            const expiracao = usuario.resetPasswordExpires ? new Date(usuario.resetPasswordExpires) : null;
            if (expiracao && expiracao < new Date()) {
                console.log("❌ Token expirado!");
                return res.status(401).json({ error: "Token expirado" });
            }
    
            const { novaSenha } = req.body;
    
            if (!novaSenha) {
                return res.status(400).json({ error: "Nova senha é obrigatória" });
            }
    
            // Alterar a senha
            usuario.senha = novaSenha;
    
            // Limpar o token após a redefinição da senha
    usuario.resetPasswordToken = null;
    usuario.resetPasswordExpires = null;
    
            await usuario.save();
    
            console.log("✅ Senha alterada com sucesso para o usuário:", usuario.email);
            return res.json({ message: "Senha alterada com sucesso!" });
    
        } catch (error) {
            console.error("❌ Erro ao alterar senha:", error);
            return res.status(500).json({ error: "Erro ao alterar senha" });
        }
    };
    
  // Rota: api/validate-reset-token
 if (url.startsWith("/api/validate-reset-token")) { 
        if (req.method !== "GET") {
            return res.status(405).json({ error: "Método não permitido" });
        }
    
        try {
            await connectDB();
            const token = req.query.token;
    
            if (!token) {
                return res.status(400).json({ error: "Token ausente" });
            }
    
            const usuario = await User.findOne({ resetPasswordToken: token });
    
            if (!usuario) {
                return res.status(401).json({ error: "Link inválido ou expirado" });
            }
    
            // Obtenha a data de expiração de forma consistente
            const expiracao = usuario.resetPasswordExpires;
    
            if (!expiracao) {
                return res.status(401).json({ error: "Data de expiração não encontrada" });
            }
    
            // Log para ver a data de expiração
            console.log("Data de expiração do token:", expiracao);
    
            // Data atual em UTC
            const agora = new Date().toISOString();
    
            // Log para ver a data atual
            console.log("Data atual (agora):", agora);
    
            // Converter para milissegundos desde 1970
            const expiracaoMs = new Date(expiracao).getTime();
            const agoraMs = new Date(agora).getTime();
    
            // Log para ver as datas em milissegundos
            console.log("Expiração em milissegundos:", expiracaoMs);
            console.log("Agora em milissegundos:", agoraMs);
    
            // Se a data atual for maior que a data de expiração, o token expirou
            if (agoraMs > expiracaoMs) {
                console.log("Token expirado.");
                return res.status(401).json({ error: "Link inválido ou expirado" });
            }
    
            // Se o token ainda estiver dentro do prazo de validade
            return res.json({ valid: true });
    
        } catch (error) {
            return res.status(500).json({ error: "Erro ao validar token" });
        }
    };
    
  // Rota: api/supportMessages
 if (url.startsWith("/api/supportMessages")) { 
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token ausente' });
  }

  const token = authHeader.split(' ')[1];

  try {
    await connectDB();

    const user = await User.findOne({ token });

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (req.method === 'GET') {
      // Retornar lista de sessões (última mensagem de cada uma)
      const sessions = await Message.aggregate([
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$session_id',
            lastMessage: { $first: '$message' },
            lastFrom: { $first: '$from' },
            lastTime: { $first: '$timestamp' },
          }
        },
        { $sort: { lastTime: -1 } }
      ]);

      return res.status(200).json({ sessions });
    }

    if (req.method === 'POST') {
      const { session_id, message } = req.body;

      if (!session_id || !message) {
        return res.status(400).json({ error: 'session_id e message são obrigatórios' });
      }

      await Message.create({
        session_id,
        from: 'support',
        message,
        timestamp: new Date()
      });

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Método não permitido' });
  } catch (error) {
    console.error('Erro em /api/supportMessages:', error);
    return res.status(500).json({ error: 'Erro interno do servidor' });
  }
}

// Rota: /api/get_saldo
if (url.startsWith("/api/get_saldo")) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Método não permitido' });
    }

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token ausente' });
    }

    const token = authHeader.split(' ')[1];

    try {
        await connectDB();

        const user = await User.findOne({ token });

        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        return res.status(200).json({ saldo: user.saldo || 0 });
    } catch (error) {
        console.error('Erro ao buscar saldo:', error);
        return res.status(500).json({ error: 'Erro interno do servidor' });
    }
}

// Rota: /api/gerar-pagamento
if (url.startsWith("/api/gerar-pagamento")) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const { amount, token } = req.body;

  if (!amount || amount < 1 || amount > 1000) {
    return res.status(400).json({ error: "Valor inválido. Min: 1, Max: 1000" });
  }

  if (!token) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  await connectDB();

  const user = await User.findOne({ token });

  if (!user) {
    return res.status(404).json({ error: "Usuário não encontrado" });
  }

  try {

    const response = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: "Bearer APP_USR-6408647281310844-111910-2b9ac05357a51450c4d1b20822c223ca-3002778257",
        "Content-Type": "application/json",
        "X-Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify({
        transaction_amount: Number(parseFloat(amount).toFixed(2)),
        payment_method_id: "pix",
        description: "Depósito via PIX",
        payer: {
          email: user.email
        },
        external_reference: user._id.toString()
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(data);
      return res.status(500).json({ error: "Erro ao gerar pagamento", detalhes: data });
    }

    const { point_of_interaction, id } = data;

    // 🔽 Salva o registro do depósito no MongoDB com createdAt manual
    await Deposito.create({
      userEmail: user.email,
      payment_id: String(id),
      amount: parseFloat(amount),
      status: "pending",
      createdAt: new Date()  // 👈 criado agora e usado depois na limpeza (30 min)
    });

    return res.status(200).json({
      payment_id: id,
      qr_code_base64: point_of_interaction.transaction_data.qr_code_base64,
      qr_code: point_of_interaction.transaction_data.qr_code
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: "Erro interno ao processar pagamento" });
  }
}

// Rota: /api/confirmar-pagamento
if (url.startsWith("/api/confirmar-pagamento")) {   
if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    await connectDB();

    const { authorization } = req.headers;
    if (!authorization || !authorization.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token não fornecido" });
    }

    const token = authorization.split(" ")[1];
    const usuario = await User.findOne({ token });

    if (!usuario) {
      return res.status(401).json({ error: "Token inválido ou usuário não encontrado!" });
    }

    // 🔄 Atualizar status automaticamente:
    // De "pendente" para "progress" se validadas > 0
    await Action.updateMany(
      { status: "pendente", validadas: { $gt: 0 } },
      { $set: { status: "progress" } }
    );

    // De "pendente" ou "progress" para "completed" se validadas === quantidade
    await Action.updateMany(
      { status: { $in: ["pendente", "progress"] }, $expr: { $eq: ["$validadas", "$quantidade"] } },
      { $set: { status: "completed" } }
    );

    // 🔎 Filtro dinâmico conforme status da query
    const status = req.query.status;
    const filtro = { userId: usuario._id };

    if (status && status !== "todos") {
      if (status === "pending") {
        filtro.validadas = 0;
      } else if (status === "progress") {
        filtro.validadas = { $gt: 0 };
        filtro.status = "progress";
      } else {
        filtro.status = status;
      }
    }

    // 🔍 Buscar ações do usuário
    const acoes = await Action.find(filtro).sort({ dataCriacao: -1 });

    // 🔗 Buscar os serviços relacionados
    const idsServico = [...new Set(acoes.map(a => a.id_servico))];
    const servicos = await Servico.find({ id_servico: { $in: idsServico } });

    // 🧩 Anexar detalhes dos serviços a cada ação
    const acoesComDetalhes = acoes.map(acao => {
      const obj = acao.toObject();
      obj.servicoDetalhes = servicos.find(s => s.id_servico === obj.id_servico) || null;
      return obj;
    });

    return res.json({ acoes: acoesComDetalhes });

  } catch (error) {
    console.error("Erro ao buscar histórico de ações:", error);
    return res.status(500).json({ error: "Erro ao buscar histórico de ações" });
  }
};

if (url.startsWith("/api/check_payment")) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Método não permitido" });

  await connectDB();

  const { payment_id } = req.query;
  if (!payment_id) {
    return res.status(400).json({ error: "payment_id é obrigatório" });
  }

  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${payment_id}`, {
    headers: {
      Authorization: "Bearer APP_USR-6408647281310844-111910-2b9ac05357a51450c4d1b20822c223ca-3002778257"
    }
  });

  const paymentData = await paymentResponse.json();

  if (!paymentResponse.ok) {
    return res.status(500).json({ error: "Erro no Mercado Pago", detalhes: paymentData });
  }

  // Buscar depósito correspondente
  const deposito = await Deposito.findOne({ payment_id });

  if (!deposito) {
    return res.status(404).json({ error: "Depósito não encontrado" });
  }

  // Se já confirmado, apenas retorna
  if (deposito.status === "completed") {
    return res.json({ status: "completed" });
  }

  // Se Mercado Pago confirmou o pagamento
  if (paymentData.status === "approved") {
    deposito.status = "completed";
    await deposito.save();

    // Atualizar saldo do usuário
    await User.updateOne(
      { email: deposito.userEmail },
      { $inc: { saldo: deposito.amount } }
    );

    return res.json({ status: "completed" });
  }

  return res.json({ status: paymentData.status });
}

// Rota: /api/listar-depositos
if (url.startsWith("/api/listar-depositos")) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  const token = authHeader.split(" ")[1];

  try {
    await connectDB();

    const usuario = await User.findOne({ token });
    if (!usuario) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    // 🕒 Tempo limite: 30 minutos
    const limiteTempo = new Date(Date.now() - 30 * 60 * 1000);

    // 🧹 Limpa pagamentos pendentes que passaram de 30 min
    await Deposito.deleteMany({
      userEmail: usuario.email,
      status: "pending",
      createdAt: { $lte: limiteTempo }
    });

    // ✅ Busca pendentes (menos de 30 min) + completed
    const depositos = await Deposito.find({
      userEmail: usuario.email,
      $or: [
        { status: "completed" },
        { status: "pending", createdAt: { $gt: limiteTempo } }
      ]
    })
      .sort({ createdAt: -1 })
      .limit(20);

    return res.status(200).json(depositos);

  } catch (error) {
    console.error("Erro ao listar depósitos:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
}

    return res.status(404).json({ error: "Rota não encontrada." });
}
