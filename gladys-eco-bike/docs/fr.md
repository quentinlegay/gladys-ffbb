# Éco Vélo

Chaque trajet fait à vélo plutôt qu'en voiture évite du CO₂ et économise de l'argent.
Cette intégration lit vos activités **Strava**, compare chaque kilomètre avec **la
voiture que vous auriez prise**, et le valorise au **prix du carburant de la station la
plus proche de chez vous**.

## Ce que vous obtenez

- Un appareil **Éco Vélo** : CO₂ évité (kg), argent économisé (€) et distance (km) au
  total, cette année et ce mois-ci, le nombre de trajets et le dernier trajet.
- Un appareil **Prix du carburant** : le prix auquel les trajets sont valorisés, et la
  station d'où il vient.
- Deux déclencheurs de scène : **Trajet écolo enregistré** (un événement par nouveau
  trajet) et **Palier de CO₂** (tous les 50 kg évités par défaut).
- Une action de scène, **Lire les économies**, pour une période (total, année, mois,
  semaine) : pour vous envoyer un bilan chaque semaine, par exemple.
- Deux widgets de tableau de bord : **Économies Éco Vélo** (totaux et 12 derniers mois)
  et **Derniers trajets écolos**.

## Créer une application Strava

Strava n'a pas d'application partagée pour les logiciels auto-hébergés : chacun crée la
sienne, gratuitement, en deux minutes.

1. Ouvrez [strava.com/settings/api](https://www.strava.com/settings/api), connecté à
   votre compte Strava.
2. Remplissez le formulaire : un nom quelconque (« Gladys »), un site quelconque, et dans
   **Authorization Callback Domain** le domaine de l'adresse avec laquelle vous ouvrez
   Gladys (par exemple `gladys.example.com`, ou `localhost` si Gladys est ouvert sur cet
   ordinateur). Avec Gladys Plus, c'est le domaine de Gladys Plus. Si Strava répond
   « redirect_uri invalid » à la connexion, le domaine à écrire est affiché, après cette première tentative, par le
   bouton **Tester** de l'intégration et dans ses logs.
3. Copiez le **Client ID** et le **Client Secret** dans la configuration de
   l'intégration, et enregistrez.
4. Cliquez sur **Connecter** et acceptez sur la page de Strava. L'intégration demande à
   lire vos activités, privées comprises (les trajets du quotidien le sont souvent).

## Quels trajets comptent

Un trajet compte quand il a remplacé un trajet en voiture :

- **Activités comptées** : par défaut seulement celles marquées **Trajet
  domicile-travail** dans Strava (une case de l'activité, qui peut aussi être cochée par
  défaut pour un vélo dans les réglages de votre matériel). Choisissez **Toutes les
  activités** pour compter toutes vos sorties.
- **Sports** : vélo (électrique compris), ou vélo, marche et course.
- **Compter à partir du** : une date de début (AAAA-MM-JJ), ou vide pour tout
  l'historique Strava.

Le home trainer et les sorties virtuelles ne comptent jamais. Changer ces réglages
recalcule les totaux aussitôt, sans relire Strava.

## Le véhicule comparé

- **Énergie** : gazole, SP95, SP95-E10, SP98, E85, GPL ou électrique.
- **Consommation** : litres aux 100 km (kWh aux 100 km pour une voiture électrique).
- **CO₂ par km** : laissez 0 pour l'estimer d'après la consommation avec les facteurs
  ADEME du puits à la roue (gazole 3,16 kg/L, essence 2,80 kg/L, E10 2,70, E85 1,50,
  GPL 1,86, électricité française 0,052 kg/kWh), ou écrivez la valeur de votre voiture.
- **Autres frais par km** : usure, pneus, entretien, stationnement… ajoutés pour chaque
  kilomètre (0 : carburant seul). Le barème kilométrique fiscal donne une idée du coût
  complet d'une voiture.

## Le prix du carburant

L'intégration lit les prix déclarés par les stations (données ouvertes du gouvernement,
[prix-carburants.gouv.fr](https://www.prix-carburants.gouv.fr)) autour de la maison
localisée dans Gladys (Paramètres → Maisons), toutes les 6 heures :

- **Station** : la plus proche qui vend votre carburant, ou la moins chère dans le
  **rayon de recherche**.
- Chaque trajet est valorisé au prix de **son jour** : un changement de prix ultérieur
  ne réécrit pas ce qu'un trajet passé a économisé. Les trajets antérieurs au premier
  prix lu utilisent ce premier prix.
- **Prix fixe** : s'il est renseigné, il remplace les stations. Utilisez-le à l'étranger
  (les données ne couvrent que la France) et pour une voiture électrique (votre prix du
  kWh). Avec une voiture électrique sans prix fixe, 0,20 €/kWh est utilisé.

Sans maison localisée ni station dans le rayon, un prix moyen français est utilisé et le
texte **Station** le signale.

## Requêtes et confidentialité

- Strava : tout l'historique une fois (pages de 200 activités), puis seulement la
  dernière semaine à chaque lecture (toutes les 60 minutes par défaut). Strava autorise
  100 requêtes par 15 minutes par application : une lecture en utilise une ou deux.
- Prix des carburants : une requête toutes les 6 heures.
- Seuls l'identifiant, le nom, le sport, la distance, la date et le marquage
  domicile-travail de chaque activité sont conservés, dans le volume propre de
  l'intégration. Rien n'est envoyé ailleurs.

## Boutons

- **Tester** : lit Strava et le prix du carburant maintenant et montre ce qui est
  compté.
- **Relire tout l'historique** : utile seulement après avoir modifié sur Strava des
  activités de plus d'une semaine (les lectures régulières relisent les 7 derniers
  jours).

## Scènes

**Trajet écolo enregistré** fournit `name`, `sport`, `date`, `distance_km`, `co2_kg`,
`money` et les totaux `total_co2_kg`, `total_money`, `total_distance_km`. Un trajet est
annoncé s'il apparaît dans les 7 jours suivant son départ ; la première lecture après la
connexion, ou après un changement de réglages, n'annonce rien.

**Palier de CO₂** fournit `milestone_kg`, les totaux et `trips`.

**Lire les économies** renvoie `co2_kg`, `money`, `distance_km`, `trips`, `fuel_price`
et une phrase `summary` toute faite.

## Dépannage

- _Strava n'est pas connecté_ : renseignez l'ID client et le secret, enregistrez, puis
  cliquez sur Connecter.
- _redirect_uri invalid_ sur la page de Strava : l'Authorization Callback Domain de votre
  application Strava n'est pas le domaine de Gladys (voir plus haut).
- _Aucun trajet compté_ : marquez vos trajets « Trajet domicile-travail » dans Strava, ou
  choisissez Toutes les activités.
