# Deploiement sur NAS Synology

## Mise a jour apres un push sur GitHub

Se connecter en SSH au NAS :

```bash
ssh GaelB@192.168.1.47
```

Puis executer ces commandes :

```bash
cd /volume1/docker/penya-barca-nantes
git pull origin main
sudo docker compose -f docker-compose.prod.yml up -d --build
```

Si des modifications de base de donnees ont ete faites (nouveau champ, nouvelle table) :

```bash
sudo docker compose -f docker-compose.prod.yml --profile tools run --rm migrate
```

## Commandes utiles

### Voir les logs

```bash
sudo docker compose -f docker-compose.prod.yml logs -f app
```

### Verifier que tout tourne

```bash
sudo docker compose -f docker-compose.prod.yml ps
```

### Redemarrer l'application

```bash
sudo docker compose -f docker-compose.prod.yml restart app
```

### Tout arreter et relancer

```bash
sudo docker compose -f docker-compose.prod.yml down
sudo docker compose -f docker-compose.prod.yml up -d
```

### Sauvegarder la base de donnees

```bash
sudo bash /volume1/docker/penya-barca-nantes/backup.sh
```

### Restaurer un backup

```bash
cat fichier_backup.sql | sudo docker compose -f docker-compose.prod.yml exec -T postgres psql -U penya penya_barca_nantes
```

### Passer un utilisateur en admin

```bash
sudo docker compose -f docker-compose.prod.yml exec postgres psql -U penya penya_barca_nantes -c "UPDATE \"user\" SET role = 'admin' WHERE email = 'email@exemple.com';"
```

## Informations

| Element | Valeur |
|---------|--------|
| URL | https://blaugrananantes.com |
| Dossier NAS | /volume1/docker/penya-barca-nantes |
| Branche | main |
| Fichier env | /volume1/docker/penya-barca-nantes/.env |
| Certificat SSL | Let's Encrypt (renouvellement auto) |
| Reverse Proxy | DSM > Portail de connexion > Proxy inverse |
