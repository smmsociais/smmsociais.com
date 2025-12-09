// server.js
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import apiRoutes from "./api/handler.js";
import twoFARoutes from "./routes/twofa.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

app.use("/api", apiRoutes);

app.use("/api/2fa", twoFARoutes);

app.use(express.static(__dirname));

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

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log("Servidor rodando na porta " + PORT));
