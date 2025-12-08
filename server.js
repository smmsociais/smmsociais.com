// server.js

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./api/handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// -------------------------------
// 1) Declarar rotas API
// -------------------------------
const apiMappedRoutes = [
  "/api/login",
  "/api/signup",
  "/api/change-password",
  "/api/recover-password",
  "/api/validate-reset-token",
  "/api/account",
  "/api/confirmar-pagamento",
  "/api/incrementar-validadas",
  "/api/orders",
  "/api/get_saldo",
  "/api/listar-depositos",
  "/api/gerar-pagamento",
  "/api/check_payment"
];

// -------------------------------
// 2) Registrar rotas da API PRIMEIRO
// -------------------------------
apiMappedRoutes.forEach(route => {
  app.use(route, apiRoutes);
});

// Mantém fallback geral
app.use("/api", apiRoutes);

// -------------------------------
// 3) Só depois servir arquivos estáticos
// -------------------------------
app.use(express.static(__dirname));


// -------------------------------
// 4) Rotas HTML
// -------------------------------
const htmlPages = {
  "/": "index.html",
  "/painel": "painel.html",
  "/login": "index.html",
  "/signup": "signup.html",
  "/orders": "orders.html",
  "/orders/pending": "orders/pending.html",
  "/orders/inprogress": "orders/inprogress.html",
  "/orders/completed": "orders/completed.html",
  "/orders/partial": "orders/partial.html",
  "/orders/processing": "orders/processing.html",
  "/orders/canceled": "orders/canceled.html",
  "/services": "services.html",
  "/servicos": "servicos.html",
  "/affiliates": "affiliates.html",
  "/massorder": "massorder.html",
  "/addfunds": "addfunds.html",
  "/account": "account.html",
  "/recover-password": "recover-password.html",
  "/reset-password": "reset-password.html",
  "/termos": "termos.html",
  "/api": "api.html",
  "/example.txt": "example.txt"
};

Object.entries(htmlPages).forEach(([route, file]) => {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
});

// -------------------------------
// 5) Fallback final
// -------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -------------------------------
// 6) Iniciar servidor
// -------------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
