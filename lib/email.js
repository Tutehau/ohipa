const nodemailer = require('nodemailer');

// Un seul transporteur réutilisé pour toute l'application.
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10),
    secure: String(process.env.SMTP_PORT) === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Bornage des temps réseau : un SMTP injoignable échoue vite au lieu de pendre.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
  return transporter;
}

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

async function send(to, subject, html) {
  return getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html,
  });
}

exports.sendInviteEmail = (username, email, password) =>
  send(email, 'Bienvenue sur Ohipa',
    `<p>Bonjour ${username},</p>
     <p>Un compte vient d'être créé pour vous. Vos identifiants&nbsp;:</p>
     <ul><li>Utilisateur&nbsp;: <b>${username}</b></li><li>Mot de passe&nbsp;: <b>${password}</b></li></ul>
     <p><a href="${BASE_URL}/login.html">Se connecter</a></p>`);

exports.sendActivationEmail = (username, email, token) =>
  send(email, 'Activez votre compte Ohipa',
    `<p>Bonjour ${username},</p>
     <p>Merci pour votre inscription. Cliquez sur le lien ci-dessous pour activer votre compte&nbsp;:</p>
     <p><a href="${BASE_URL}/activate.html?token=${token}">Activer mon compte</a></p>`);

exports.sendResetEmail = (username, email, token) =>
  send(email, 'Réinitialisation de votre mot de passe',
    `<p>Bonjour ${username},</p>
     <p>Vous avez demandé la réinitialisation de votre mot de passe. Ce lien expire dans 1 heure&nbsp;:</p>
     <p><a href="${BASE_URL}/new-password.html?token=${token}">Choisir un nouveau mot de passe</a></p>
     <p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`);
