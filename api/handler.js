// handler.js

import express from "express";
import axios from "axios";
import connectDB from "./db.js";
import mongoose from "mongoose";
import { sendRecoveryEmail } from "./mailer.js";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { User, Deposito, Action, ActionHistory, Servico } from "./schema.js";

// 🔹 IMPORTAÇÃO DAS ROTAS INDEPENDENTES
import googleSignup from "./auth/google/signup.js";
import googleSignupCallback from "./auth/google/signup/callback.js";
import googleLogin from "./auth/google.js";
import googleCallback from "./auth/google/callback.js";

import criarAcaoInstagram from "./criar_acao_instagram.js";
import criarAcaoTikTok from "./criar_acao_tiktok.js";
import userInfo from "./user-info.js";

// 🔹 INSTANCIA O ROUTER
const router = express.Router();

/* ======================================================
   ROTAS INDEPENDENTES (SEMPRE NO TOPO)
   ====================================================== */

// 🔹 Rotas de autenticação Google
router.get("/auth/google", googleLogin);
router.get("/auth/google/callback", googleCallback);
router.get("/auth/google/signup", googleSignup);
router.get("/auth/google/signup/callback", googleSignupCallback);

// 🔹 Rotas de criação de ações
router.post("/criar_acao_instagram", criarAcaoInstagram);
router.post("/criar_acao_tiktok", criarAcaoTikTok);

// 🔹 User info
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

    // Rota: /api/login (POST)
router.post("/login", async (req, res) => {
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
});

// rota: POST /api/signup
router.post("/signup", async (req, res) => {
  await connectDB();

  const { email, senha } = req.body;
  if (!email || !senha) return res.status(400).json({ error: "Todos os campos são obrigatórios." });

  try {
    const emailExiste = await User.findOne({ email });
    if (emailExiste) {
      return res.status(400).json({ error: "E-mail já está cadastrado." });
    }

    const novoUsuario = new User({ email, senha });
    await novoUsuario.save();

    // Gera token e retorna para frontend salvar
    const token = jwt.sign({ id: novoUsuario._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    return res.status(201).json({ message: "Usuário registrado com sucesso!", token });
  } catch (error) {
    console.error("Erro ao cadastrar usuário:", error);
    return res.status(500).json({ error: "Erro interno ao registrar usuário. Tente novamente mais tarde." });
  }
});

// Rota: /api/recover-password
router.post("/recover-password", async (req, res) => {

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email é obrigatório" });
  }

  try {
    await connectDB();

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ error: "Email não encontrado" });
    }

    const token = crypto.randomBytes(32).toString("hex");

    const expires = Date.now() + 30 * 60 * 1000; // 30 min

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

export default router;
