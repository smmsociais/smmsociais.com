import mongoose from "mongoose";

/* 🔹 Schema do Usuário */
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  senha: { type: String, default: null }, 
  provider: { type: String, default: "local" }, 
  googleId: { type: String, default: null },
  avatar: { type: String, default: null },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  saldo: { type: Number, default: 0 },
  // campos 2FA
  twoFACode: { type: String, default: null },
  twoFAExpires: { type: Date, default: null },
  twoFAEnabled: { type: Boolean, default: false },
  twoFADisableCode: { type: String, default: null },
  twoFADisableExpires: { type: Date, default: null },
  codigoAfiliado: { type: String, unique: true }, // código do próprio usuário
  indicadoPor: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // quem indicou
  indicacoes: { type: Number, default: 0 }, // contador de indicações
}, { timestamps: true });

/* 🔹 Histórico de Ações Realizadas */
const actionHistorySchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  token: { type: String, required: true },
  nome_usuario: { type: String, required: true },
  id_pedido: { type: String, required: true },
  id_conta: { type: String, required: true },
  url_dir: { type: String, required: true },
  tipo_acao: { type: String, required: true },
  quantidade_pontos: { type: Number, required: true },
  tipo: { type: String, default: "seguir" },
  rede_social: { type: String, default: "TikTok" },
  valor_confirmacao: { type: Number, required: true },
  acao_validada: { 
    type: String, 
    enum: ["pendente", "valida", "invalida", "pulada"], 
    default: "pendente"
  },
  data: { type: Date, default: Date.now },
  processing: { type: Boolean, default: false },
  verify_attempts: { type: Number, default: 0 },
  verificada_em: { type: Date }
}, { timestamps: true });

/* 🔹 Ações Disponíveis */
const actionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  id_servico: { type: String },
  rede: { type: String, required: true },
  tipo: { type: String, required: true },
  nome: { type: String, required: true },
  valor: { type: Number, required: true },
  quantidade: { type: Number, required: true },
  validadas: { type: Number, default: 0 },
  link: { type: String, required: true },
  status: { type: String, default: "pendente" },
  dataCriacao: { type: Date, default: Date.now },
  id_acao_smm: { type: Number },
  contagemInicial: { type: Number, default: null }
}, { timestamps: true });

/* 🔹 Depósitos via PIX (Mercado Pago) */
const depositoSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, index: true },
  payment_id: { type: String, required: true, unique: true },
  amount: { type: Number, required: true, min: 0.10 },
  status: { 
    type: String, 
    required: true,
    enum: ["pending", "completed", "expired"],
    default: "pending"
  }
}, { timestamps: true });

/* 🔹 Serviços */
const ServicoSchema = new mongoose.Schema({
  id_servico: { type: String, required: true },
  nome: { type: String, required: true },
  tipo: { type: String, required: true },
  preco_1000: { type: Number, required: true },
  minimo: { type: Number, required: true },
  maximo: { type: Number, required: true },
  tempo_medio: { type: String, required: true },
  categoria: {
    nome: { type: String, required: true },
    imagem: { type: String, required: true }
  },
  descricao: { type: String, required: true }
});

export const User =
  mongoose.models.User || mongoose.model("User", userSchema);

export const Action =
  mongoose.models.Action || mongoose.model("Action", actionSchema);

export const ActionHistory =
  mongoose.models.ActionHistory || mongoose.model("ActionHistory", actionHistorySchema);

export const Servico =
  mongoose.models.Servico || mongoose.model("Servico", ServicoSchema);

export const Deposito =
  mongoose.models.Deposito || mongoose.model("Deposito", depositoSchema);
