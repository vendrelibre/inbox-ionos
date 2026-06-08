# Inbox IONOS — POC (étape 1 : lecture seule)

Ce petit outil se connecte à ta boîte `remi.dumas@myseety.com`, lit tes derniers mails
et les enregistre dans un fichier local `emails.json`. **Il ne modifie rien dans ta boîte
et n'envoie aucun mail.** Ensuite, Claude lit `emails.json` et te montre le tri + des
exemples de brouillons de réponse.

## Étapes (à faire une seule fois)

### 1. Créer le fichier `.env`
Dans le dossier `Desktop\inbox-ionos`, fais une copie de `.env.example` et renomme-la `.env`.
Ouvre `.env` dans le Bloc-notes et remplace `colle-ici-le-mot-de-passe-de-ta-boite`
par le **mot de passe de ta boîte IONOS** (celui de la webmail).

> 🔒 Ce mot de passe reste sur ton PC, dans ce fichier. Ne le colle nulle part ailleurs
> (surtout pas dans une conversation). Tu peux le changer/révoquer côté IONOS à tout moment.

### 2. Lancer le test
Ouvre **PowerShell**, va dans le dossier et lance la commande :

```powershell
cd C:\Users\mysee\Desktop\inbox-ionos
npm run fetch
```

Si tout va bien, tu verras `💾 20 mail(s) enregistrés dans emails.json`.

### 3. Me prévenir
Dis-moi « c'est fait » : je lis `emails.json` et je te montre le classement + 2-3 brouillons.

## En cas de souci
- **Erreur d'authentification** → vérifie le mot de passe dans `.env`. Si tu as activé la
  double authentification chez IONOS, crée un « mot de passe applicatif » dans ton espace IONOS.
- **Serveur introuvable** → dans `.env`, remplace `imap.ionos.fr` par `imap.ionos.com`.
