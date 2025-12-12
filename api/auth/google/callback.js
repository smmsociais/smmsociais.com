// api/auth/google/callback.js
import axios from "axios";
import connectDB from "../../db.js";
import { User } from "../../schema.js";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  try {
    const code = req.query.code;
    const codigoIndicacao = req.query.ref || null; // 🔥 Captura ref na URL

    if (!code) {
      return res.status(400).json({ error: "Código não fornecido." });
    }

    // 1 - Trocar "code" pelo token do Google
    const { data: tokenData } = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code"
      }
    );

    const googleAccessToken = tokenData.access_token;

    // 2 - Obter dados do perfil Google
    const { data: googleUser } = await axios.get(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${googleAccessToken}` } }
    );

    const { email, name } = googleUser;

    // 3 - Conectar ao banco
    await connectDB();

    // 4 - Verificar se usuário existe
    let user = await User.findOne({ email });

    // ========== 🔥 Sistema de Afiliados Integrado ==========
    if (!user) {
      // Criar código de afiliado
      const codigoAfiliado = Math.random()
        .toString(36)
        .substring(2, 8)
        .toUpperCase();

      user = new User({
        email,
        nome: name,
        provider: "google",
        senha: "",
        saldo: 0,
        codigoAfiliado
      });

      // Se há código de indicação na URL
      if (codigoIndicacao) {
        const usuarioIndicador = await User.findOne({
          codigoAfiliado: codigoIndicacao
        });

        if (usuarioIndicador) {
          // Relacionar indicado
          user.indicadoPor = usuarioIndicador._id;

          // Incrementar contador
          usuarioIndicador.indicacoes =
            (usuarioIndicador.indicacoes || 0) + 1;
          await usuarioIndicador.save();
        }
      }

      await user.save();
    }
    // ========================================================

    // 5 - Gerar JWT
    const token = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    // 6 - Redirecionar para o Frontend
    const FRONTEND_BASE =
      process.env.FRONTEND_URL || "https://smmsociais.com";

    return res.redirect(
      `${FRONTEND_BASE}/login-success?token=${token}`
    );

  } catch (error) {
    console.error("Erro no callback do Google:", error?.response?.data || error);
    return res.status(500).json({
      error: "Erro interno ao processar login."
    });
  }
}
