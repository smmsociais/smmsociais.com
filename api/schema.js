import mongoose from "mongoose";

/* 🔹 Schema do Usuário */
const userSchema = new mongoose.Schema({
  nome: { type: String },
  email: { type: String, required: true, unique: true },
  // Senha opcional (para login normal)
  senha: { type: String, default: null },
  // Login com Google
  provider: { type: String, default: "local" }, // local, google
  googleId: { type: String, default: null },
  avatar: { type: String, default: null },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  saldo: { type: Number, default: 0 }
}, {
  timestamps: true
});

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
  contagemInicial: { type: Number, default: null } // <-- novo campo
}, { timestamps: true });

/* 🔹 Depósitos via PIX (Mercado Pago) */
const depositoSchema = new mongoose.Schema({
  userEmail: { type: String, required: true, index: true },

  payment_id: { 
    type: String, 
    required: true, 
    unique: true // evita duplicações vindas do Mercado Pago
  },

  amount: { 
    type: Number, 
    required: true, 
    min: 0.10 // previne valores inválidos ou zerados
  },

  status: { 
    type: String, 
    required: true,
    enum: ["pending", "completed", "expired"],
    default: "pending"
  }
}, { 
  timestamps: true // necessário para limpar pendentes com mais de 30 min
});


// 🔹 Exportação dos modelos
export const User = mongoose.model("User", userSchema);
export const Action = mongoose.model("Action", actionSchema);
export const ActionHistory = mongoose.model("ActionHistory", actionHistorySchema);
export const Deposito = mongoose.model("Deposito", depositoSchema);
