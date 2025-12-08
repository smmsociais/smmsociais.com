import express from "express";
import axios from "axios";
import connectDB from "./db.js";
import mongoose from "mongoose";
import { sendRecoveryEmail } from "./mailer.js";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { User, Deposito, Action, ActionHistory, Servico } from "./schema.js";

const router = express.Router();

// ----------------------------------------------
// GET /api/get_saldo
// ----------------------------------------------
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

// ----------------------------------------------

export default router;
