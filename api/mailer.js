// mailer.js

import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendRecoveryEmail(email, link) {
  try {
    await resend.emails.send({
      from: "SMMSociais <no-reply@smmsociais.com>",
      to: email,
      subject: "Recuperação de Senha",
      html: `
        <p>Você solicitou a recuperação de senha.</p>
        <p>Clique no link abaixo para redefinir sua senha:</p>
        <p><a href="${link}">${link}</a></p>
        <p>Se você não solicitou essa recuperação, apenas ignore este email.</p>
      `,
    });

    console.log(`Link de recuperação enviado para ${email}`);
    return true;
  } catch (error) {
    console.error("Erro ao enviar email com Resend:", error);
    throw new Error("Erro ao enviar email de recuperação");
  }
}
