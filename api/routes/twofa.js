// twofa.js
import express from "express";
import { Resend } from "resend";
import { User } from "../schema.js";
import connectDB from "../db.js";

const router = express.Router();

// Inicializa o Resend com a API Key
const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * @route POST /api/2fa/send
 * @desc Gera e envia código 2FA por e-mail usando Resend
 */
router.post("/send", async (req, res) => {
  try {
    await connectDB();

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "E-mail é obrigatório." });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    // Gera código aleatório de 6 dígitos
    const code = Math.floor(100000 + Math.random() * 900000);
    const expiration = Date.now() + 5 * 60 * 1000; // 5 minutos

    // Salva no banco
    user.twoFACode = code;
    user.twoFAExpires = expiration;
    await user.save();

    // Envia o e-mail via Resend
    const emailResponse = await resend.emails.send({
      from: "SMMSociais <no-reply@smmsociais.com>", // domínio verificado no Resend
      to: email,
      subject: "Seu código de verificação 2FA",
      html: `
        <div style="font-family:sans-serif;max-width:400px;margin:auto;">
          <h2>🔐 Verificação de login</h2>
          <p>Use o código abaixo para confirmar seu login:</p>
          <h1 style="text-align:center;font-size:32px;">${code}</h1>
          <p style="color:#777;text-align:center;">Válido por 5 minutos.</p>
        </div>
      `,
    });

    console.log("📧 Resend response:", emailResponse);

    res.json({ success: true, message: "Código 2FA enviado para o e-mail." });
  } catch (err) {
    console.error("Erro ao enviar 2FA:", err);
    res.status(500).json({ error: "Erro ao enviar código 2FA." });
  }
});

/**
 * @route POST /api/2fa/verify
 * @desc Valida o código 2FA enviado por e-mail
 */
router.post("/verify", async (req, res) => {
  try {
    await connectDB();

    const { email, code } = req.body;
    if (!email || !code)
      return res.status(400).json({ error: "E-mail e código são obrigatórios." });

    const user = await User.findOne({ email });
    if (!user || !user.twoFACode)
      return res.status(400).json({ error: "Código 2FA não encontrado." });

    if (Date.now() > user.twoFAExpires) {
      user.twoFACode = null;
      user.twoFAExpires = null;
      await user.save();
      return res.status(400).json({ error: "Código expirado. Solicite um novo." });
    }

    if (String(user.twoFACode) !== String(code)) {
      return res.status(401).json({ error: "Código incorreto." });
    }

    // Código correto → limpa os campos
    user.twoFACode = null;
    user.twoFAExpires = null;
    await user.save();

    res.json({ success: true, message: "2FA verificado com sucesso." });
  } catch (err) {
    console.error("Erro ao verificar 2FA:", err);
    res.status(500).json({ error: "Erro ao verificar código 2FA." });
  }
});

export default router;
