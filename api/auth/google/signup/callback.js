// api/auth/google/signup/callback.js
import axios from "axios";
import connectDB from "../../../db.js";
import { User } from "../../../schema.js";
import jwt from "jsonwebtoken";

const FRONTEND_BASE = process.env.FRONTEND_URL || "https://smmsociais.com";

export default async function handler(req, res) {
  try {
    await connectDB();

    // Vamos obter o código de indicação (ref)
    const codigoIndicacao = req.query.ref || null;

    // === 1) Fluxo POST (Google One Tap / Credential)
    if (req.method === "POST") {
      const { credential, ref } = req.body;

      const codigoRef = ref || codigoIndicacao;

      if (!credential) {
        return res
          .status(400)
          .json({ success: false, error: "credential ausente" });
      }

      // Validar ID_TOKEN
      const { data: info } = await axios.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
      );

      const { email, name, picture } = info;

      let user = await User.findOne({ email });

      // ---------- 🔥 Criação com Afiliados -----------
      if (!user) {
        // gerar código afiliado do novo usuário
        const codigoAfiliado = Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();

        user = new User({
          email,
          nome: name,
          avatar: picture,
          provider: "google",
          senha: "",
          codigoAfiliado,
        });

        if (codigoRef) {
          const usuarioIndicador = await User.findOne({
            codigoAfiliado: codigoRef,
          });

          if (usuarioIndicador) {
            user.indicadoPor = usuarioIndicador._id;

            usuarioIndicador.indicacoes =
              (usuarioIndicador.indicacoes || 0) + 1;

            await usuarioIndicador.save();
          }
        }

        await user.save();
      }
      // ----------------------------------------------------

      const token = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        success: true,
        token,
        codigoAfiliado: user.codigoAfiliado,
      });
    }

    // === 2) Fluxo GET (OAuth Code)
    if (req.method === "GET") {
      const code = req.query.code;
      if (!code) return res.status(400).json({ error: "Código não fornecido." });

      const { data: tokenData } = await axios.post(
        "https://oauth2.googleapis.com/token",
        {
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: process.env.GOOGLE_REDIRECT_URI_SIGNUP,
          grant_type: "authorization_code",
        }
      );

      const googleAccessToken = tokenData.access_token;

      const { data: googleUser } = await axios.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${googleAccessToken}` } }
      );

      const { email, name, picture } = googleUser;

      let user = await User.findOne({ email });

      // ---------- 🔥 Criação com Afiliados -----------
      if (!user) {
        const codigoAfiliado = Math.random()
          .toString(36)
          .substring(2, 8)
          .toUpperCase();

        user = new User({
          email,
          nome: name,
          avatar: picture,
          provider: "google",
          senha: "",
          codigoAfiliado,
        });

        if (codigoIndicacao) {
          const usuarioIndicador = await User.findOne({
            codigoAfiliado: codigoIndicacao,
          });

          if (usuarioIndicador) {
            user.indicadoPor = usuarioIndicador._id;

            usuarioIndicador.indicacoes =
              (usuarioIndicador.indicacoes || 0) + 1;

            await usuarioIndicador.save();
          }
        }

        await user.save();
      }
      // ----------------------------------------------------

      const token = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );

      return res.redirect(
        `${FRONTEND_BASE}/login-success?token=${token}`
      );
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).end("Method Not Allowed");

  } catch (err) {
    console.error("Erro em signup/callback:", err?.response?.data || err);
    return res.status(500).json({ success: false, error: "Erro interno" });
  }
}
