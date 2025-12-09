// api/routes/twofa.js
import express from "express";
import jwt from "jsonwebtoken";
import connectDB from "../db.js";
import { User } from "../schema.js";
import { Resend } from "resend";

const router = express.Router();
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * POST /api/2fa/send
 * Gera código, salva no usuário e envia por Resend (email).
 */
router.post("/send", async (req, res) => {
  console.log("[2FA][SEND] request received");
  try {
    await connectDB();

    const { email } = req.body;
    console.log("[2FA][SEND] body:", req.body);

    if (!email) {
      console.log("[2FA][SEND] missing email");
      return res.status(400).json({ error: "E-mail é obrigatório." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      console.log("[2FA][SEND] user not found:", email);
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    // Gera código aleatório de 6 dígitos (salvamos como string)
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiration = Date.now() + 5 * 60 * 1000;

    // Salva no banco ANTES de enviar o e-mail
    user.twoFACode = code;
    user.twoFAExpires = new Date(expiration);
    await user.save();
    console.log(`[2FA][SEND] saved code for ${email}:`, code);

    // Tenta enviar via Resend (caso falhe, o código permanece salvo)
    try {
      const sendResult = await resend.emails.send({
        from: process.env.RESEND_FROM || "SMMSociais <no-reply@smmsociais.com>",
        to: email,
        subject: "Seu código de verificação 2FA",
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px;">
            <h2 style="text-align:center;color:#4CAF50;">🔐 Verificação em Duas Etapas</h2>
            <p>Use o código abaixo para confirmar seu login:</p>
            <h1 style="text-align:center;font-size:36px;letter-spacing:4px;">${code}</h1>
            <p style="text-align:center;color:#777;">Válido por 5 minutos.</p>
          </div>
        `,
      });
      console.log("[2FA][SEND] email sent result:", sendResult);
    } catch (emailErr) {
      console.error("[2FA][SEND] error sending email (but code saved):", emailErr);
      // Ainda retornamos success porque o código foi salvo — mas reportamos aviso
      return res.status(200).json({
        success: true,
        message: "Código gerado e salvo, mas houve problema ao enviar o e-mail (ver logs).",
      });
    }

    return res.status(200).json({ success: true, message: "Código 2FA enviado para o e-mail." });
  } catch (err) {
    console.error("[2FA][SEND] erro geral:", err);
    return res.status(500).json({ error: "Erro ao enviar código 2FA." });
  }
});

/**
 * POST /api/2fa/verify
 * Verifica o código; se ok, ativa o twoFAEnabled.
 */
router.post("/verify", async (req, res) => {
  console.log("[2FA][VERIFY] request received");
  try {
    await connectDB();

    const { email, code } = req.body;
    console.log("[2FA][VERIFY] body:", req.body);

    if (!email || !code) {
      console.log("[2FA][VERIFY] missing fields");
      return res.status(400).json({ error: "E-mail e código são obrigatórios." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      console.log("[2FA][VERIFY] user not found:", email);
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    if (!user.twoFACode) {
      console.log("[2FA][VERIFY] no code saved for user");
      return res.status(400).json({ error: "Código 2FA não encontrado." });
    }

    const now = Date.now();
    const expires = user.twoFAExpires ? new Date(user.twoFAExpires).getTime() : 0;
    console.log("[2FA][VERIFY] code saved:", user.twoFACode, "expires:", expires, "now:", now);

    if (now > expires) {
      user.twoFACode = null;
      user.twoFAExpires = null;
      await user.save();
      console.log("[2FA][VERIFY] code expired, cleared.");
      return res.status(400).json({ error: "Código expirado. Solicite um novo." });
    }

    if (String(user.twoFACode) !== String(code)) {
      console.log("[2FA][VERIFY] code mismatch:", code, "!==", user.twoFACode);
      return res.status(401).json({ error: "Código incorreto." });
    }

    // Código correto → ativa o 2FA
    user.twoFACode = null;
    user.twoFAExpires = null;
    user.twoFAEnabled = true;
    await user.save();
    console.log("[2FA][VERIFY] 2FA activated for:", email);

    return res.status(200).json({ success: true, message: "2FA ativado com sucesso." });
  } catch (err) {
    console.error("[2FA][VERIFY] erro geral:", err);
    return res.status(500).json({ error: "Erro ao verificar código 2FA." });
  }
});

/**
 * POST /api/2fa/status
 */
router.post("/status", async (req, res) => {
  console.log("[2FA][STATUS] request received");
  try {
    await connectDB();

    const { email } = req.body;
    console.log("[2FA][STATUS] body:", req.body);

    if (!email) return res.status(400).json({ error: "E-mail é obrigatório." });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    return res.status(200).json({ success: true, twoFAEnabled: !!user.twoFAEnabled });
  } catch (err) {
    console.error("[2FA][STATUS] erro geral:", err);
    return res.status(500).json({ error: "Erro ao verificar status do 2FA." });
  }
});

/**
 * POST /api/2fa/disable/send
 * Envia código por e-mail para desativação do 2FA.
 * Requer Authorization: Bearer <token>
 */
router.post("/disable/send", async (req, res) => {
  console.log("[2FA][DISABLE][SEND] request received");
  try {
    await connectDB();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token ausente." });
    }
    const token = authHeader.split(" ")[1];

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("[2FA][DISABLE][SEND] token inválido:", err);
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const user = await User.findById(payload.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    if (!user.twoFAEnabled) {
      return res.status(400).json({ error: "2FA não está ativo para este usuário." });
    }

    // Gera código e validade (5 minutos)
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiration = Date.now() + 5 * 60 * 1000;

    user.twoFADisableCode = code;
    user.twoFADisableExpires = new Date(expiration);
    await user.save();

    // Envia e-mail via Resend (mantendo consistência com /send)
    try {
      await resend.emails.send({
        from: process.env.RESEND_FROM || "SMMSociais <no-reply@smmsociais.com>",
        to: user.email,
        subject: "Código para desativar 2FA",
        html: `
          <div style="font-family:sans-serif;max-width:400px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px;">
            <h2 style="text-align:center;color:#e53935;">🔒 Desativar 2FA</h2>
            <p>Você solicitou desativar a verificação em duas etapas. Use o código abaixo para confirmar:</p>
            <h1 style="text-align:center;font-size:36px;letter-spacing:4px;">${code}</h1>
            <p style="text-align:center;color:#777;">Válido por 5 minutos.</p>
          </div>
        `,
      });
      console.log("[2FA][DISABLE][SEND] email enviado para:", user.email);
    } catch (emailErr) {
      console.error("[2FA][DISABLE][SEND] erro ao enviar e-mail (mas código salvo):", emailErr);
      return res.status(200).json({
        success: true,
        message: "Código gerado e salvo, porém houve problema ao enviar o e-mail (ver logs).",
      });
    }

    return res.status(200).json({ success: true, message: "Código enviado por e-mail." });
  } catch (err) {
    console.error("[2FA][DISABLE][SEND] erro geral:", err);
    return res.status(500).json({ error: "Erro ao processar solicitação." });
  }
});

/**
 * POST /api/2fa/disable/confirm
 * Body: { code: "123456" }
 * Requer Authorization: Bearer <token>
 * Valida código e desativa twoFAEnabled
 */
router.post("/disable/confirm", async (req, res) => {
  console.log("[2FA][DISABLE][CONFIRM] request received");
  try {
    await connectDB();

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Token ausente." });
    }
    const token = authHeader.split(" ")[1];

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      console.error("[2FA][DISABLE][CONFIRM] token inválido:", err);
      return res.status(401).json({ error: "Token inválido ou expirado." });
    }

    const { code } = req.body;
    if (!code) return res.status(400).json({ error: "Código é obrigatório." });

    const user = await User.findById(payload.id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    if (!user.twoFADisableCode) return res.status(400).json({ error: "Nenhum código gerado. Solicite reinício do processo." });

    const now = Date.now();
    const expires = user.twoFADisableExpires ? new Date(user.twoFADisableExpires).getTime() : 0;
    if (now > expires) {
      user.twoFADisableCode = null;
      user.twoFADisableExpires = null;
      await user.save();
      return res.status(400).json({ error: "Código expirado. Solicite um novo." });
    }

    if (String(user.twoFADisableCode) !== String(code)) {
      return res.status(401).json({ error: "Código incorreto." });
    }

    // Código válido: desativa 2FA
    user.twoFADisableCode = null;
    user.twoFADisableExpires = null;
    user.twoFAEnabled = false;
    user.twoFACode = null;
    user.twoFAExpires = null;
    await user.save();

    console.log("[2FA][DISABLE][CONFIRM] 2FA desativado para:", user.email);
    return res.status(200).json({ success: true, message: "2FA desativado com sucesso." });
  } catch (err) {
    console.error("[2FA][DISABLE][CONFIRM] erro geral:", err);
    return res.status(500).json({ error: "Erro ao confirmar desativação do 2FA." });
  }
});

export default router;
