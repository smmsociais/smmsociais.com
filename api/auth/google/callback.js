import axios from "axios";
import connectDB from "../../db.js";          // <-- CORRETO
import { User } from "../../schema.js";       // <-- CORRETO
import { sendRecoveryEmail } from "../../mailer.js"; // <-- CORRETO
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  const code = req.query.code;

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

  // 2 - Obter dados do perfil
  const { data: googleUser } = await axios.get(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${googleAccessToken}` } }
  );

  const { email, name, picture } = googleUser;

  // 3 - Conectar ao banco
  await connectDB();

  // 4 - Verificar se já existe usuário
  let user = await User.findOne({ email });

  if (!user) {
    user = await User.create({
      email,
      nome: name,
      avatar: picture,
      provider: "google"
    });
  }

  // 5 - Gerar JWT
  const token = jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  // 6 - Redireciona de volta ao frontend
  res.redirect(`/login-success?token=${token}`);
}
