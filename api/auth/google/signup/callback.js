// api/auth/google/signup/callback.js
import axios from "axios";
import connectDB from "../../../db.js";
import { User } from "../../../schema.js";
import jwt from "jsonwebtoken";

const FRONTEND_BASE = process.env.FRONTEND_URL || "https://smmsociais.com";

// Função para gerar código afiliado único
const generateUniqueAffiliateCode = async () => {
  let code;
  let exists;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
    exists = await User.findOne({ codigoAfiliado: code });
  } while (exists);
  return code;
};

export default async function handler(req, res) {
  try {
    await connectDB();

    // === 1) Se for POST: tratamos credential (Google Identity / One Tap)
    if (req.method === "POST") {
      const { credential, codigoIndicacao } = req.body;
      if (!credential) {
        return res.status(400).json({ success: false, error: "credential ausente" });
      }

      // Validar id_token (credential) via tokeninfo
      const { data: info } = await axios.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
      );

      // info contém email, name, picture quando válido
      const { email, name } = info;

      // Verifica se o email já existe
      let user = await User.findOne({ email });
      if (user) {
        // Usuário já existe, apenas faz login
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
        return res.status(200).json({ 
          success: true, 
          token,
          message: "Login realizado com sucesso"
        });
      }

      // Cria código de afiliado único
      const codigoAfiliado = await generateUniqueAffiliateCode();

      // Inicia sessão para transação atômica
      const session = await mongoose.startSession();
      
      try {
        session.startTransaction();

        // Se foi enviado um código de indicação válido, busca o usuário indicador
        let indicadorId = null;
        if (codigoIndicacao) {
          const usuarioIndicador = await User.findOne({ 
            codigoAfiliado: codigoIndicacao 
          }).session(session);
          
          if (usuarioIndicador) {
            indicadorId = usuarioIndicador._id;
            
            // Incrementa contador de indicações
            await User.updateOne(
              { _id: usuarioIndicador._id },
              { $inc: { indicacoes: 1 } },
              { session }
            );
          }
        }

        // Cria o novo usuário
        user = await User.create([{
          email,
          nome: name,
          provider: "google",
          senha: "", // Senha vazia pois é autenticação por Google
          codigoAfiliado,
          indicadoPor: indicadorId,
          indicacoes: 0
        }], { session });

        user = user[0]; // create retorna array quando usado com session

        await session.commitTransaction();

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        return res.status(201).json({ 
          success: true, 
          token,
          codigoAfiliado,
          message: "Cadastro realizado com sucesso!",
          indicadoPor: indicadorId ? "Sim" : "Não"
        });

      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    }

    // === 2) Se for GET: tratamos o fluxo OAuth (code -> exchange -> redirect)
    if (req.method === "GET") {
      const { code, state } = req.query;
      if (!code) return res.status(400).json({ error: "Código não fornecido." });

      // Extrair código de indicação do state (se presente)
      let codigoIndicacao = null;
      if (state) {
        try {
          // O state pode ser uma string codificada ou apenas o código
          if (state.includes(':')) {
            const decodedState = decodeURIComponent(state);
            const parts = decodedState.split(':');
            codigoIndicacao = parts[1] || null; // formato: "random:CODIGO"
          } else {
            codigoIndicacao = state;
          }
        } catch (e) {
          console.warn("Erro ao decodificar state:", e);
        }
      }

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

      const { email, name } = googleUser;

      // Verifica se o email já existe
      let user = await User.findOne({ email });
      if (user) {
        // Usuário já existe, redireciona para login
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
        return res.redirect(`${FRONTEND_BASE}/login-success?token=${token}&message=login`);
      }

      // Cria código de afiliado único
      const codigoAfiliado = await generateUniqueAffiliateCode();

      const session = await mongoose.startSession();
      
      try {
        session.startTransaction();

        // Verifica código de indicação
        let indicadorId = null;
        if (codigoIndicacao) {
          const usuarioIndicador = await User.findOne({ 
            codigoAfiliado: codigoIndicacao 
          }).session(session);
          
          if (usuarioIndicador) {
            indicadorId = usuarioIndicador._id;
            
            // Incrementa contador de indicações
            await User.updateOne(
              { _id: usuarioIndicador._id },
              { $inc: { indicacoes: 1 } },
              { session }
            );
          }
        }

        // Cria novo usuário
        user = await User.create([{
          email,
          nome: name,
          provider: "google",
          senha: "",
          codigoAfiliado,
          indicadoPor: indicadorId,
          indicacoes: 0
        }], { session });

        user = user[0];

        await session.commitTransaction();

        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

        // Redireciona com parâmetros adicionais
        return res.redirect(
          `${FRONTEND_BASE}/login-success?token=${token}&codigo=${codigoAfiliado}&message=cadastro&indicado=${indicadorId ? 'sim' : 'nao'}`
        );

      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    }

    // método não permitido
    res.setHeader("Allow", "GET, POST");
    return res.status(405).end("Method Not Allowed");

  } catch (err) {
    console.error("Erro em signup/callback:", err?.response?.data || err);
    
    // Redireciona para página de erro em caso de GET
    if (req.method === 'GET') {
      return res.redirect(`${FRONTEND_BASE}/erro?message=${encodeURIComponent("Erro no cadastro")}`);
    }
    
    return res.status(500).json({ 
      success: false, 
      error: "Erro interno no servidor" 
    });
  }
}
