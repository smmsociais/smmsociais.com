// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./api/handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// -----------------------------------------------
// 1) MAPA DE ROTAS QUE USAM handler.js
// -----------------------------------------------
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

// Aplica as rotas antes dos arquivos estáticos
apiMappedRoutes.forEach(route => {
  app.use(route, apiRoutes);
});

// Mantém fallback /api
app.use("/api", apiRoutes);

// -----------------------------------------------
// 2) ARQUIVOS ESTÁTICOS
// -----------------------------------------------
app.use(express.static(__dirname));

// -----------------------------------------------
// 3) ROTAS HTML DEFINIDAS (igual ao vercel.json)
// -----------------------------------------------
const htmlPages = {
  "/": "index.html",
  "/painel": "painel.html",
  "/login": "index.html",
  "/login-success": "login-success.html",
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

// -----------------------------------------------
// 4) CATCH-ALL (SPA) → devolve index.html
// -----------------------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -----------------------------------------------
// 5) INICIA SERVIDOR
// -----------------------------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
