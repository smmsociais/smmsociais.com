import connectDB from "./connectDB";
import User from "./schema";

export default async function handler(req, res) {
  try {
    await connectDB();

    const token = req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Token obrigatório" });

    const user = await User.findById(token);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    res.json({ saldo: user.saldo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erro interno" });
  }
}
