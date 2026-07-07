// Garde d'authentification : rejette si aucune session utilisateur.
exports.isAuth = (req, res, next) => {
  if (req.session.userId) return next();
  res.status(401).json({ message: 'Non authentifié' });
};

// Garde d'autorisation : réservé aux administrateurs.
exports.isAdmin = (req, res, next) => {
  if (req.session.role === 'admin') return next();
  res.status(403).json({ message: 'Accès administrateur requis' });
};
