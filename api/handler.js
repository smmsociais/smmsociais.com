// handler.js
import express from "express";
import axios from "axios";
import connectDB from "./db.js";
import mongoose from "mongoose";
import { sendRecoveryEmail } from "./mailer.js";
import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import { User, Deposito, Action, Servico } from "./schema.js";

// IMPORTAÇÃO DAS ROTAS INDEPENDENTES
import googleSignup from "./auth/google/signup.js";
import googleSignupCallback from "./auth/google/signup/callback.js";
import googleLogin from "./auth/google.js";
import googleCallback from "./auth/google/callback.js";
import criarAcaoInstagram from "./criar_acao_instagram.js";
import criarAcaoTikTok from "./criar_acao_tiktok.js";
import userInfo from "./user-info.js";

const router = express.Router();

router.get("/auth/google", googleLogin);
router.get("/auth/google/callback", googleCallback);
router.get("/auth/google/signup", googleSignup);
router.get("/auth/google/signup/callback", googleSignupCallback);
router.post("/criar_acao_instagram", criarAcaoInstagram);
router.post("/criar_acao_tiktok", criarAcaoTikTok);
router.get("/user-info", userInfo);

// ROTA: GET /api/get_saldo
router.get("/get_saldo", async (req, res) => {
  console.log("➡️ Rota GET SALDO capturada");

  await connectDB();

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token ausente" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // id do usuário vem do JWT
    const userId = decoded.id;

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    return res.status(200).json({ saldo: user.saldo || 0 });

  } catch (error) {
    console.error("Erro ao buscar saldo:", error);
    return res.status(500).json({ error: "Token inválido ou erro interno" });
  }
});

// ROTA: GET /api/servico
router.get("/servico", async (req, res) => {
    try {
        const servicos = await Servico.find({});
        return res.status(200).json(servicos);
    } catch (error) {
        console.error("Erro ao buscar serviços:", error);
        return res.status(500).json({ error: "Erro ao carregar serviços" });

  }
});


// GET /api/account
router.get('/account', async (req, res) => {
  try {
    await connectDB();

    const authHeader = req.headers.authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const token = authHeader.split(" ")[1].trim();
    console.log("🔐 Token recebido:", token);

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.warn("Token inválido/expirado:", err.message);
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) {
      return res.status(401).json({ error: "Token inválido (id ausente)." });
    }

    const usuario = await User.findById(userId);
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    return res.status(200).json({
      nome_usuario: usuario.nome,
      email: usuario.email,
      // não retorne senha
      userId: String(usuario._id),
      id: String(usuario._id)
    });

  } catch (error) {
    console.error("💥 Erro ao processar GET /account:", error);
    return res.status(500).json({ error: "Erro ao obter dados do perfil." });
  }
});

// GET /api/account
router.get('/account', async (req, res) => {
  try {
    await connectDB();

    const authHeader = req.headers.authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const token = authHeader.split(" ")[1].trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) return res.status(401).json({ error: "Token inválido (id ausente)." });

    const usuario = await User.findById(userId);
    if (!usuario) return res.status(404).json({ error: "Usuário não encontrado." });

    return res.status(200).json({
      nome_usuario: usuario.nome,
      email: usuario.email,
      userId: String(usuario._id),
      id: String(usuario._id)
    });

  } catch (error) {
    console.error("Erro GET /account:", error);
    return res.status(500).json({ error: "Erro ao obter dados do perfil." });
  }
});

// PUT /api/account
router.put('/account', async (req, res) => {
  try {
    await connectDB();

    const authHeader = req.headers.authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const token = authHeader.split(" ")[1].trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) return res.status(401).json({ error: "Token inválido (id ausente)." });

    const usuario = await User.findById(userId);
    if (!usuario) return res.status(404).json({ error: "Usuário não encontrado." });

    const { nome_usuario, email, senha_atual, nova_senha } = req.body;

    const updateFields = {
      nome: nome_usuario || usuario.nome,
      email: email || usuario.email
    };

    // Alteração de senha sem hash (texto puro)
    if (nova_senha) {
      if (!senha_atual) {
        return res.status(400).json({ error: "Você deve informar a senha atual para alterar a senha." });
      }

      if (senha_atual !== usuario.senha) {
        return res.status(403).json({ error: "Senha atual incorreta." });
      }

      if (nova_senha.length < 6) {
        return res.status(400).json({ error: "A nova senha deve ter no mínimo 6 caracteres." });
      }

      // Salva a nova senha em texto puro
      updateFields.senha = nova_senha;
    }

    const usuarioAtualizado = await User.findByIdAndUpdate(userId, updateFields, { new: true });

    if (!usuarioAtualizado) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    return res.status(200).json({
      message: "Perfil atualizado com sucesso!",
      user: {
        nome_usuario: usuarioAtualizado.nome,
        email: usuarioAtualizado.email
      }
    });

  } catch (error) {
    console.error("Erro PUT /account:", error);
    return res.status(500).json({ error: "Erro ao atualizar perfil." });
  }
});

    // Rota: /api/login (POST)
router.post("/login", async (req, res) => {
  try {
    await connectDB(); // <- garante conexão antes de qualquer query

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
});

// rota: POST /api/signup
router.post("/signup", async (req, res) => {
  await connectDB();

  const { email, senha, codigoIndicacao } = req.body;
  if (!email || !senha)
    return res.status(400).json({ error: "Todos os campos são obrigatórios." });

  try {
    // Verifica se o e-mail já está cadastrado
    const emailExiste = await User.findOne({ email });
    if (emailExiste) {
      return res.status(400).json({ error: "E-mail já está cadastrado." });
    }

    // Cria código de indicação único para o novo usuário
    const codigoAfiliado = Math.random().toString(36).substring(2, 8).toUpperCase();

    // Cria o novo usuário
    const novoUsuario = new User({
      email,
      senha,
      codigoAfiliado,
    });

    // Se foi enviado um código de indicação válido, associa o afiliador
    if (codigoIndicacao) {
      const usuarioIndicador = await User.findOne({ codigoAfiliado: codigoIndicacao });
      if (usuarioIndicador) {
        novoUsuario.indicadoPor = usuarioIndicador._id;

        // (opcional) incrementa contador de indicações
        usuarioIndicador.indicacoes = (usuarioIndicador.indicacoes || 0) + 1;
        await usuarioIndicador.save();
      }
    }

    await novoUsuario.save();

    // Gera token de autenticação
    const token = jwt.sign({ id: novoUsuario._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    return res.status(201).json({
      message: "Usuário registrado com sucesso!",
      token,
      codigoAfiliado, // retorna o código do novo usuário
    });
  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);
    return res
      .status(500)
      .json({ error: "Erro interno ao registrar usuário. Tente novamente mais tarde." });
  }
});

// Rota: /api/recover-password
router.post("/recover-password", async (req, res) => {

  const { email } = req.body;

  if (!email)
    return res.status(400).json({ error: "Email é obrigatório" });

  try {
    await connectDB();
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user)
      return res.status(404).json({ error: "Email não encontrado" });

    // Gera token corretamente
    const token = randomBytes(32).toString("hex");

    const expires = Date.now() + 30 * 60 * 1000;

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
});

// Rota: /api/validate-reset-token
router.get("/validate-reset-token", async (req, res) => {
  try {
    await connectDB();

    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ error: "Token ausente" });
    }

    // Busca usuário com token válido e ainda não expirado
    const usuario = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!usuario) {
      return res.status(401).json({ error: "Link inválido ou expirado" });
    }

    return res.json({ valid: true });

  } catch (error) {
    console.error("Erro ao validar token:", error);
    return res.status(500).json({ error: "Erro ao validar token" });
  }
});

// Rota: /api/reset-password
router.post("/reset-password", async (req, res) => {
  try {
    await connectDB();

    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return res.status(401).json({ error: "Token ausente" });
    }

    // Buscar usuário com token válido e ainda não expirado
    const usuario = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!usuario) {
      return res.status(401).json({ error: "Token inválido ou expirado" });
    }

    const { novaSenha } = req.body;

    if (!novaSenha) {
      return res.status(400).json({ error: "Nova senha é obrigatória" });
    }

    // Atualizar a senha (bcrypt será aplicado automaticamente se existir middleware no model)
    usuario.senha = novaSenha;

    // Remover token
    usuario.resetPasswordToken = null;
    usuario.resetPasswordExpires = null;

    await usuario.save();

    return res.json({ message: "Senha alterada com sucesso!" });

  } catch (error) {
    console.error("Erro ao alterar senha:", error);
    return res.status(500).json({ error: "Erro ao alterar senha" });
  }
});

// Rota: GET /api/afiliados
router.get("/afiliados", async (req, res) => {
  await connectDB();

  try {
    // Verifica se há token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token de autenticação ausente ou inválido." });
    }

    // Extrai e verifica o token
    const token = authHeader.split(" ")[1];
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    // Busca o usuário autenticado
    const usuario = await User.findById(decoded.id);
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    // Busca todos os usuários que foram indicados por ele
    const afiliados = await User.find({ indicadoPor: usuario._id })
      .select("email createdAt codigoAfiliado") // campos retornados
      .sort({ createdAt: -1 });

    // Retorna resultado
    return res.status(200).json({
      afiliador: {
        email: usuario.email,
        codigoAfiliado: usuario.codigoAfiliado,
        totalIndicacoes: usuario.indicacoes || afiliados.length,
      },
      afiliados: afiliados,
    });
  } catch (error) {
    console.error("Erro ao buscar afiliados:", error);
    return res.status(500).json({ error: "Erro interno ao buscar afiliados." });
  }
});

// Rota: /api/orders
router.get("/orders", async (req, res) => {
    await connectDB();

  try {
   const authHeader = req.headers.authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const token = authHeader.split(" ")[1].trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) return res.status(401).json({ error: "Token inválido (id ausente)." });

    const usuario = await User.findById(userId);
    if (!usuario) return res.status(404).json({ error: "Usuário não encontrado." });

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
    const servicos = idsServico.length > 0
      ? await Servico.find({ id_servico: { $in: idsServico } })
      : [];

    // ---------- Montar retorno ----------
    const CONCURRENCY = 5;
    const queue = [...acoes];
    const acoesComDetalhes = [];

    while (queue.length > 0) {
      const batch = queue.splice(0, CONCURRENCY);

      const promises = batch.map(async acao => {
        const obj = acao.toObject();
        obj.id = obj.id_acao_smm || obj._id.toString();
        obj.servicoDetalhes = servicos.find(s => s.id_servico === obj.id_servico) || null;

        // Agora NÃO existe mais follower_count.
        // Apenas retornamos contagemInicial sem tocar em APIs externas.
        if (obj.contagemInicial === undefined || obj.contagemInicial === null) {
          obj.contagemInicial = 0;
        } else {
          obj.contagemInicial = Number(obj.contagemInicial) || 0;
        }

        return obj;
      });

      const results = await Promise.all(promises);
      acoesComDetalhes.push(...results);

      if (queue.length > 0) await new Promise(r => setTimeout(r, 150));
    }

    return res.json({ acoes: acoesComDetalhes });

  } catch (error) {
    console.error("Erro ao buscar histórico de ações:", error);
    return res.status(500).json({ error: "Erro ao buscar histórico de ações" });
  }
});

// Rota: /api/gerar-pagamento
router.post("/gerar-pagamento", async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    // ==============================
    // 🔐 AUTENTICAÇÃO (JWT via Bearer)
    // ==============================
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const token = authHeader.split(" ")[1].trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) {
      return res.status(401).json({ error: "Token inválido (id ausente)." });
    }

    await connectDB();

    const usuario = await User.findById(userId);
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    // ==============================
    // 🔢 VALIDAÇÃO DO AMOUNT
    // ==============================
    const { amount } = req.body;

    if (!amount || amount < 1 || amount > 1000) {
      return res.status(400).json({
        error: "Valor inválido. Min: 1, Max: 1000"
      });
    }

    // ==============================
    // 💳 CRIAR PAGAMENTO PIX
    // ==============================
    try {
      const response = await fetch("https://api.mercadopago.com/v1/payments", {
        method: "POST",
        headers: {
          Authorization: "Bearer APP_USR-6408647281310844-111910-2b9ac05357a51450c4d1b20822c223ca-3002778257",
          "Content-Type": "application/json",
          "X-Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          transaction_amount: Number(parseFloat(amount).toFixed(2)),
          payment_method_id: "pix",
          description: "Depósito via PIX",
          payer: {
            email: usuario.email,
          },
          external_reference: usuario._id.toString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error(data);
        return res.status(500).json({ error: "Erro ao gerar pagamento", detalhes: data });
      }

      const { point_of_interaction, id } = data;

      // ==============================
      // 💾 SALVAR REGISTRO NO MONGODB
      // ==============================
      await Deposito.create({
        userEmail: usuario.email,
        payment_id: String(id),
        amount: parseFloat(amount),
        status: "pending",
        createdAt: new Date(),
      });

      // ==============================
      // 🔽 RETORNO AO CLIENTE
      // ==============================
      return res.status(200).json({
        payment_id: id,
        qr_code_base64: point_of_interaction.transaction_data.qr_code_base64,
        qr_code: point_of_interaction.transaction_data.qr_code,
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({
        error: "Erro interno ao processar pagamento",
      });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro interno no servidor" });
  }
});

// Rota: /api/confirmar-pagamento
router.get("/confirmar-pagamento", async (req, res) => {  
if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    // ==============================
    // 🔐 AUTENTICAÇÃO (JWT via Bearer)
    // ==============================
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const token = authHeader.split(" ")[1].trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) {
      return res.status(401).json({ error: "Token inválido (id ausente)." });
    }

    await connectDB();

    const usuario = await User.findById(userId);
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado." });
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
});

// Rota: /api/check_payment
router.get("/check_payment", async (req, res) => {  
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
);

// Rota: /api/listar-depositos
router.get("/listar-depositos", async (req, res) => {  
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    // ==============================
    // 🔐 AUTENTICAÇÃO (JWT via Bearer)
    // ==============================
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Não autorizado." });
    }

    const token = authHeader.split(" ")[1].trim();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const userId = decoded.id || decoded.userId || decoded.sub;
    if (!userId) {
      return res.status(401).json({ error: "Token inválido (id ausente)." });
    }

    await connectDB();

    const usuario = await User.findById(userId);
    if (!usuario) {
      return res.status(404).json({ error: "Usuário não encontrado." });
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
});

export default router;
