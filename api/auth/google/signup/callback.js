import axios from "axios";
import connectDB from "../../db.js";
import { User } from "../../schema.js";
import jwt from "jsonwebtoken";

export default async function handler(req, res) {
  const code = req.query.code;

  if (!code) {
    return res.status(400).json({ error: "Código não fornecido." });
  }

  // 1 - Trocar "code" por access_token
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

  // 2 - Buscar dados do usuário no Google
  const { data: googleUser } = await axios.get(
    "https://www.googleapis.com/oauth2/v2/userinfo",
    { headers: { Authorization: `Bearer ${googleAccessToken}` } }
  );

  const { email, name, picture } = googleUser;

  // 3 - Conectar ao MongoDB
  await connectDB();

  // 4 - Verificar se o email já está cadastrado
  let user = await User.findOne({ email });

  if (user) {
    // Usuário já existe → redireciona pro login com token
    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.redirect(`/painel?token=${token}`);
  }

  // 5 - Criar novo usuário
  user = await User.create({
    email,
    nome: name,
    avatar: picture,
    provider: "google",
    senha: "", // não requer senha
  });

  // 6 - Criar JWT
  const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  // 7 - Redirecionar para o painel
  return res.redirect(`/painel?token=${token}`);
}
